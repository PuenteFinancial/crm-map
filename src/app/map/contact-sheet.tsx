"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  googleMapsDirections,
  type MapContact,
  type Visit,
} from "@/lib/contacts";
import { CATEGORIES, PRIORITIES, STAGES, type Category, type Owner, type Priority, type Stage } from "@/lib/types";
import { getVisits, setAddress, updateContact } from "./actions";
import { LogVisitForm } from "./log-visit-form";

type Props = {
  contact: MapContact;
  me: Owner | null;
  onClose: () => void;
  onPlacePin: () => void;
};

export function ContactSheet({ contact: c, me, onClose, onPlacePin }: Props) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [logging, setLogging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVisits(c.id).then((v) => !cancelled && setVisits(v));
    return () => {
      cancelled = true;
    };
  }, [c.id, c.last_visit_at]);

  function save(patch: Parameters<typeof updateContact>[1]) {
    setError(null);
    startTransition(async () => {
      try {
        await updateContact(c.id, patch);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  const hasPin = c.map_lat != null && c.map_lng != null;
  const action = "flex flex-1 flex-col items-center gap-0.5 rounded-xl bg-neutral-100 py-2 text-xs font-medium text-neutral-800";
  const select = "rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm";

  return (
    <section
      className={`absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-2xl bg-white text-neutral-900 shadow-[0_-8px_30px_rgba(0,0,0,0.15)]
        md:inset-y-3 md:left-auto md:right-3 md:w-96 md:rounded-2xl ${expanded ? "max-h-[92dvh]" : "max-h-[60dvh]"} md:max-h-none`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex justify-center py-2 md:hidden"
        aria-label={expanded ? "Collapse" : "Expand"}
      >
        <span className="h-1 w-10 rounded-full bg-neutral-300" />
      </button>

      <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-4">
        <header className="flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-lg font-semibold leading-tight">{c.name}</h2>
            <p className="text-sm text-neutral-500">
              {[c.role, c.company_name].filter(Boolean).join(" · ") || "No role or company yet"}
            </p>
            {c.next_meeting_at && (
              <p className="mt-1 text-sm font-medium text-amber-700">Meeting {formatWhen(c.next_meeting_at)}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-full bg-neutral-100 px-2.5 py-1 text-sm" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex gap-2">
          {c.phone && <a href={`tel:${c.phone}`} className={action}><span>📞</span>Call</a>}
          {c.phone && <a href={`sms:${c.phone}`} className={action}><span>💬</span>Text</a>}
          {c.email && <a href={`mailto:${c.email}`} className={action}><span>✉️</span>Email</a>}
          {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" className={action}><span>in</span>LinkedIn</a>}
          {hasPin && (
            <a href={googleMapsDirections(c.map_lat!, c.map_lng!)} target="_blank" rel="noreferrer" className={action}>
              <span>🧭</span>Directions
            </a>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Category
            <select className={select} value={c.category} disabled={pending} onChange={(e) => save({ category: e.target.value as Category })}>
              {CATEGORIES.map((v) => <option key={v} value={v}>{CATEGORY_LABELS[v]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Priority
            <select className={select} value={c.priority} disabled={pending} onChange={(e) => save({ priority: e.target.value as Priority })}>
              {PRIORITIES.map((v) => <option key={v} value={v}>{PRIORITY_LABELS[v]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Stage
            <select
              className={select}
              value={c.stage ?? ""}
              disabled={pending}
              onChange={(e) => save({ stage: (e.target.value || null) as Stage | null })}
            >
              <option value="">—</option>
              {STAGES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>

        <LocationRow contact={c} onPlacePin={onPlacePin} />

        {error && <p className="text-sm text-red-600">{error}</p>}

        {logging ? (
          <LogVisitForm contact={c} me={me} onDone={() => setLogging(false)} />
        ) : (
          <button
            onClick={() => {
              setLogging(true);
              setExpanded(true);
            }}
            className="rounded-xl bg-neutral-900 py-3 font-medium text-white"
          >
            Log a visit
          </button>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">History</h3>
          {visits === null ? (
            <p className="text-sm text-neutral-500">Loading…</p>
          ) : visits.length === 0 ? (
            <p className="text-sm text-neutral-500">No visits yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visits.map((v) => (
                <li key={v.id} className="rounded-xl border border-neutral-200 px-3 py-2 text-sm">
                  <p className="font-medium">
                    {v.status === "scheduled" ? "Scheduled " : ""}
                    {v.type} · {v.starts_at ? formatWhen(v.starts_at) : "no date"}
                    {v.who && <span className="font-normal text-neutral-500"> · {v.who}</span>}
                  </p>
                  {v.outcome && <p>{v.outcome}</p>}
                  {v.notes && <p className="whitespace-pre-wrap text-neutral-600">{v.notes}</p>}
                  {v.next_step && <p className="text-neutral-600">Next: {v.next_step}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {(c.notes || c.email || c.phone || c.relationship) && (
          <div className="flex flex-col gap-1 text-sm">
            <h3 className="font-semibold">Details</h3>
            {c.relationship && <p className="text-neutral-600">Relationship: {c.relationship}</p>}
            {c.owner && <p className="text-neutral-600">Owner: {c.owner}</p>}
            {c.email && <p className="text-neutral-600">{c.email}</p>}
            {c.phone && <p className="text-neutral-600">{c.phone}</p>}
            {c.notes && <p className="mt-1 whitespace-pre-wrap text-neutral-700">{c.notes}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function LocationRow({ contact: c, onPlacePin }: { contact: MapContact; onPlacePin: () => void }) {
  const [editing, setEditing] = useState(false);
  const [address, setAddressValue] = useState(c.address ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const status =
    c.map_lat == null
      ? "No location yet"
      : c.location_from_company
        ? `At ${c.company_name}'s location`
        : c.geocode_confidence === "manual"
          ? "Pin placed by hand"
          : c.geocode_confidence === "city" || c.geocode_confidence === "low"
            ? "Rough location (city level)"
            : null;

  return (
    <div className={`flex flex-col gap-2 rounded-xl px-3 py-2 text-sm ${c.needs_review ? "bg-amber-50" : "bg-neutral-50"}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          {c.address && <p>{c.address}</p>}
          {status && <p className="text-neutral-500">{status}</p>}
        </div>
        <button onClick={onPlacePin} className="shrink-0 text-blue-600 underline">
          {c.map_lat == null ? "Drop pin" : "Move pin"}
        </button>
        <button onClick={() => setEditing(!editing)} className="shrink-0 text-blue-600 underline">
          {c.address ? "Edit address" : "Add address"}
        </button>
      </div>
      {editing && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await setAddress(c.id, address);
              setMessage(res.message);
              if (res.ok) setEditing(false);
            });
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddressValue(e.target.value)}
            placeholder="Street, city"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-[16px]"
          />
          <button disabled={pending || !address.trim()} className="rounded-lg bg-neutral-900 px-3 text-white disabled:opacity-50">
            {pending ? "…" : "Save"}
          </button>
        </form>
      )}
      {message && <p className="text-neutral-600">{message}</p>}
    </div>
  );
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
