import { createClient } from "@supabase/supabase-js";

// Scripts run outside Next, so load .env.local ourselves and use the secret key.
process.loadEnvFile(".env.local");

export const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
