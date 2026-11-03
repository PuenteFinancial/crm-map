"use client";

import { useActionState, useEffect } from "react";
import { signIn, type LoginState } from "./actions";

const field = "rounded-lg border border-neutral-300 px-3 py-3 text-[16px] dark:border-neutral-700 dark:bg-neutral-900";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, {} as LoginState);

  // Reaching this page means there's no session. Pages the service worker saved hold contact
  // data, so delete them however the session ended (sign-out, expiry, cleared cookies).
  useEffect(() => {
    if (!("caches" in window)) return;
    caches.keys().then((keys) => keys.filter((k) => k.startsWith("pages-")).forEach((k) => caches.delete(k)));
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">crm-map</h1>
        <p className="mt-1 text-sm text-neutral-500">Sign in with your email and the team passcode.</p>
      </div>
      <form action={action} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          placeholder="you@example.com"
          required
          className={field}
        />
        <input
          name="passcode"
          type="password"
          autoComplete="current-password"
          placeholder="Team passcode"
          required
          className={field}
        />
        <button
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-3 py-3 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </main>
  );
}
