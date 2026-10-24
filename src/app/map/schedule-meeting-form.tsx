"use client";

import { useState, useTransition } from "react";
import type { MapContact } from "@/lib/contacts";
import { nowWallTime, wallTimeToIso } from "@/lib/time";
import type { Owner } from "@/lib/types";
import { scheduleMeeting } from "./actions";

const field = "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[16px]";
const label = "flex flex-col gap-1 text-xs font-medium text-neutral-500";

// Next half hour, in LA time.
function nextSlot() {
  const [date, time] = nowWallTime().split("T");
  const [h, m] = time.split(":").map(Number);
  const mins = Math.ceil((h * 60 + m + 1) / 30) * 30;
  if (mins >= 24 * 60) return `${date}T09:00`;
  return `${date}T${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function ScheduleMeetingForm({ contact, me, onDone }: { contact: MapContact; me: Owner | null; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<"meeting" | "call">("meeting");
  const [elsewhere, setElsewhere] = useState(contact.map_lat == null);
  const hasLocation = contact.map_lat != null;

  function submit(form: FormData) {
    setError(null);
    const text = (k: string) => String(form.get(k) ?? "").trim() || null;
    startTransition(async () => {
      try {
        const res = await scheduleMeeting({
          contact_id: contact.id,
          type,
          starts_at: wallTimeToIso(String(form.get("when"))),
          duration_min: Number(form.get("duration")),
          who: (text("who") as "joshua" | "colton" | "both" | null),
          address: elsewhere ? text("address") : null,
          notes: text("notes"),
        });
        if (res.ok) onDone();
        else setError(res.message ?? "Couldn't save the meeting.");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Schedule</h3>
        <button type="button" onClick={onDone} className="text-sm text-neutral-500">Cancel</button>
      </div>
      <div className="flex gap-1.5">
        {(["meeting", "call"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
              type === t ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
            }`}
          >
            {t === "meeting" ? "In person" : "Call"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className={label}>
          When (LA time)
          <input name="when" type="datetime-local" defaultValue={nextSlot()} step={300} required className={field} />
        </label>
        <label className={label}>
          Length
          <select name="duration" defaultValue="45" className={field}>
            {[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
        </label>
      </div>
      {type === "meeting" && (
        <div className="flex flex-col gap-2 text-sm">
          {hasLocation && (
            <label className="flex items-center gap-2">
              <input type="radio" checked={!elsewhere} onChange={() => setElsewhere(false)} />
              At {contact.location_from_company ? contact.company_name : "their location"}
              {contact.address && <span className="truncate text-neutral-500">({contact.address})</span>}
            </label>
          )}
          {hasLocation && (
            <label className="flex items-center gap-2">
              <input type="radio" checked={elsewhere} onChange={() => setElsewhere(true)} />
              Somewhere else
            </label>
          )}
          {elsewhere && (
            <input name="address" required placeholder="Coffee shop, office address…" className={field} />
          )}
        </div>
      )}
      <label className={label}>
        Who&apos;s going
        <select name="who" defaultValue="both" className={field}>
          <option value="both">Both</option>
          <option value="joshua">Joshua{me === "joshua" ? " (me)" : ""}</option>
          <option value="colton">Colton{me === "colton" ? " (me)" : ""}</option>
        </select>
      </label>
      <label className={label}>
        Notes
        <textarea name="notes" rows={2} placeholder="Agenda, who set it up…" className={field} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={pending} className="rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save meeting"}
      </button>
    </form>
  );
}
