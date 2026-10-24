import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminSupabase } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "./env";

// Acts as the signed-in user; RLS applies.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}

// Bypasses RLS. Server-only: ingest, imports, allow-list checks.
export function createAdminClient() {
  return createAdminSupabase(supabaseUrl, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
