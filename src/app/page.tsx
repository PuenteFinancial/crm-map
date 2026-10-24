import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">crm-map</h1>
        <form action={signOut}>
          <button className="text-sm text-neutral-500 underline">Sign out</button>
        </form>
      </header>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <Summary />
      </Suspense>
    </main>
  );
}

async function Summary() {
  // getClaims() checks token expiry against the clock, so this must render per request.
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { count } = await supabase.from("contacts").select("*", { count: "exact", head: true });

  return (
    <>
      <p className="text-sm text-neutral-500">Signed in as {claims?.claims.email}</p>
      <p>{count ?? 0} contacts. The map is coming next.</p>
      <Link
        href="/add"
        className="rounded-lg bg-neutral-900 px-3 py-3 text-center font-medium text-white dark:bg-white dark:text-neutral-900"
      >
        Add contact
      </Link>
    </>
  );
}
