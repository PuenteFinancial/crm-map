"use server";

import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type LoginState = { email?: string; error?: string };

async function isTeamMember(email: string) {
  // Exact match on the lowercased address: no pattern matching, so "%" can't stand in for an email.
  const { data, error } = await createAdminClient().from("team_members").select("email").eq("email", email).maybeSingle();
  if (error) throw error;
  return data !== null;
}

// Public sign-up is off (anyone with the publishable key could otherwise register a
// team email with a password), so team members' auth users are created here instead.
async function ensureUser(email: string) {
  const { error } = await createAdminClient().auth.admin.createUser({ email, email_confirm: true });
  if (error && error.code !== "email_exists") throw error;
}

// The passcode is the shared secret, so guesses are limited per client IP and overall, never per
// submitted email (an attacker can vary that freely). At most ~100 guesses per 15 minutes makes a
// 12+ character passcode impractical to guess. The overall cap means a flood of bad attempts can
// pause new sign-ins for everyone for 15 minutes; signed-in sessions are unaffected.
const MIN_PASSCODE_LENGTH = 12;
const WINDOW_MINUTES = 15;
const MAX_PER_IP = 10;
const MAX_OVERALL = 100;

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Records this attempt first, then counts, so parallel requests can't all slip past the check:
 * each one sees every attempt inserted before its count, including its own.
 */
async function recordAttemptAndCheck(ip: string, email: string) {
  const db = createAdminClient();
  const { error } = await db.from("login_attempts").insert({ ip, email });
  if (error) throw error;
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const [byIp, overall] = await Promise.all([
    db.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since),
    db.from("login_attempts").select("id", { count: "exact", head: true }).gte("at", since),
  ]);
  if (byIp.error) throw byIp.error;
  if (overall.error) throw overall.error;
  return (byIp.count ?? 0) <= MAX_PER_IP && (overall.count ?? 0) <= MAX_OVERALL;
}

async function clearAttempts(ip: string) {
  const { error } = await createAdminClient().from("login_attempts").delete().eq("ip", ip);
  if (error) throw error;
}

function passcodeMatches(given: string) {
  const expected = process.env.TEAM_PASSCODE ?? "";
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const slowDown = () => new Promise((r) => setTimeout(r, 1000));

/**
 * Sign in with a team email + the shared TEAM_PASSCODE, no email round trip. Only for a small
 * internal team: the passcode stands in for proving you own the inbox. Supabase still issues a
 * normal session, so RLS (team_members) applies exactly as before. Attempts are limited per IP
 * and overall (see above), and the passcode must be at least 12 characters.
 */
export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const passcode = String(form.get("passcode") ?? "");
  if (!email || !passcode) return { email, error: "Enter your email and the team passcode." };
  if (!process.env.TEAM_PASSCODE) return { email, error: "Sign-in isn't set up: TEAM_PASSCODE is missing on the server." };
  if (process.env.TEAM_PASSCODE.length < MIN_PASSCODE_LENGTH) {
    return { email, error: `Sign-in is off: TEAM_PASSCODE must be at least ${MIN_PASSCODE_LENGTH} characters.` };
  }

  const ip = await clientIp();
  if (!(await recordAttemptAndCheck(ip, email))) {
    return { email, error: `Too many sign-in attempts. Try again in ${WINDOW_MINUTES} minutes.` };
  }

  if (!passcodeMatches(passcode) || !(await isTeamMember(email))) {
    await slowDown();
    return { email, error: "That email or passcode isn't right." };
  }
  await clearAttempts(ip);

  await ensureUser(email);
  // Mint a one-time sign-in token server-side (nothing is emailed) and redeem it right away,
  // which sets the session cookies for this browser.
  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error) return { email, error: error.message };
  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" });
  if (verifyError) return { email, error: verifyError.message };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
