"use server";

import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type LoginState = { email?: string; error?: string };

async function isTeamMember(email: string) {
  const { data, error } = await createAdminClient()
    .from("team_members")
    .select("email")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

// Public sign-up is off (anyone with the publishable key could otherwise register a
// team email with a password), so team members' auth users are created here instead.
async function ensureUser(email: string) {
  const { error } = await createAdminClient().auth.admin.createUser({ email, email_confirm: true });
  if (error && error.code !== "email_exists") throw error;
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
 * normal session, so RLS (team_members) applies exactly as before.
 */
export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const passcode = String(form.get("passcode") ?? "");
  if (!email || !passcode) return { email, error: "Enter your email and the team passcode." };
  if (!process.env.TEAM_PASSCODE) return { email, error: "Sign-in isn't set up: TEAM_PASSCODE is missing on the server." };

  if (!passcodeMatches(passcode) || !(await isTeamMember(email))) {
    await slowDown();
    return { email, error: "That email or passcode isn't right." };
  }

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
