"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type LoginState = { step: "email" | "code"; email?: string; error?: string };

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

export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) return { step: "email", error: "Enter your email." };

  if (!(await isTeamMember(email))) {
    return { step: "email", email, error: "That email isn't on the team list." };
  }

  await ensureUser(email);

  const origin = (await headers()).get("origin");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm`, shouldCreateUser: false },
  });
  if (error) return { step: "email", email, error: error.message };

  return { step: "code", email };
}

// The 6-digit code matters on phones: a home-screen app doesn't share cookies
// with the browser the email link opens in, so the link alone can't sign it in.
export async function verifyCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { step: "code", email, error: error.message };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
