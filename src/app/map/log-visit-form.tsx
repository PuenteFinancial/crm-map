"use client";

import { useState, useTransition } from "react";
import type { MapContact } from "@/lib/contacts";
import { STAGES, type Owner, type Stage } from "@/lib/types";
import { logVisit } from "./actions";

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const field = "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[16px]";
const label = "flex flex-col gap-1 text-xs font-medium text-neutral-500";

export function LogVisitForm({ contact, me, onDone }: { contact: MapContact; me: Owner | null; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    const text = (k: string) => String(form.get(k) ?? "").trim() || null;
    startTransition(async () => {
      try {
        await logVisit({
          contact_id: contact.id,
          type: form.get("type") as "meeting" | "drop-in" | "call",
          who: form.get("who") as "joshua" | "colton" | "both",
          starts_at: new Date(String(form.get("when"))).toISOString(),
          outcome: text("outcome"),
          notes: text("notes"),
          next_step: text("next_step"),
          stage: (text("stage") as Stage | null),
        });
        onDone();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Log a visit</h3>
        <button type="button" onClick={onDone} className="text-sm text-neutral-500">Cancel</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          Type
          <select name="type" defaultValue="drop-in" className={field}>
            <option value="drop-in">Drop-in</option>
            <option value="meeting">Meeting</option>
            <option value="call">Call</option>
          </select>
        </label>
        <label className={label}>
          Who went
          <select name="who" defaultValue={me ?? "both"} className={field}>
            <option value="both">Both</option>
            <option value="joshua">Joshua</option>
            <option value="colton">Colton</option>
          </select>
        </label>
      </div>
      <label className={label}>
        When
        <input name="when" type="datetime-local" defaultValue={localNow()} required className={field} />
      </label>
      <label className={label}>
        Outcome
        <input name="outcome" placeholder="Met with founder, not in, left card…" className={field} />
      </label>
      <label className={label}>
        Notes
        <textarea name="notes" rows={3} className={field} />
      </label>
      <label className={label}>
        Next step
        <input name="next_step" placeholder="Send deck, intro to…" className={field} />
      </label>
      <label className={label}>
        Move stage to
        <select name="stage" defaultValue="" className={field}>
          <option value="">Keep {contact.stage ?? "as is"}</option>
          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={pending} className="rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save visit"}
      </button>
    </form>
  );
}
