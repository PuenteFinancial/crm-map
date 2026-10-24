"use client";

import { useActionState } from "react";
import { sendCode, verifyCode, type LoginState } from "./actions";

const initial: LoginState = { step: "email" };

export default function LoginPage() {
  const [emailState, emailAction, sending] = useActionState(sendCode, initial);
  const [codeState, codeAction, verifying] = useActionState(verifyCode, initial);

  const onCodeStep = emailState.step === "code";
  const error = onCodeStep ? codeState.error : emailState.error;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">crm-map</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {onCodeStep
            ? `We emailed a code to ${emailState.email}. Enter it here, or tap the link in the email.`
            : "Sign in with your email."}
        </p>
      </div>

      {onCodeStep ? (
        <form action={codeAction} className="flex flex-col gap-3">
          <input type="hidden" name="email" value={emailState.email} />
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            className="rounded-lg border border-neutral-300 px-3 py-3 text-lg tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            disabled={verifying}
            className="rounded-lg bg-neutral-900 px-3 py-3 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {verifying ? "Checking…" : "Sign in"}
          </button>
        </form>
      ) : (
        <form action={emailAction} className="flex flex-col gap-3">
          <input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={emailState.email}
            placeholder="you@example.com"
            required
            className="rounded-lg border border-neutral-300 px-3 py-3 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            disabled={sending}
            className="rounded-lg bg-neutral-900 px-3 py-3 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {sending ? "Sending…" : "Email me a code"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
