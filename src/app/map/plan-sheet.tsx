"use client";

import { useMemo, useState, useTransition } from "react";
import { PRIORITY_LABELS, type MapContact, type Meeting } from "@/lib/contacts";
import { googleMapsLinks } from "@/lib/route";
import { dayKey, formatDay, formatTime } from "@/lib/time";
import { addPlace } from "./plan-actions";
import { Dot } from "./ui";
import type { DayPlanState } from "./use-day-plan";

type Props = {
  plan: DayPlanState;
  contacts: MapContact[];
  meetings: Meeting[];
  onOpenContact: (id: string) => void;
  onClose: () => void;
};

const input = "rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-[16px]";
const PRIORITY_RANK = { "must-see": 0, "want-to-see": 1, "if-nearby": 2 } as const;

export function PlanSheet({ plan, contacts, meetings, onOpenContact, onClose }: Props) {
  const [view, setView] = useState<"edit" | "pick">("edit");
  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const dayMeetings = meetings.filter((m) => dayKey(m.starts_at) === plan.date);
  const picked = plan.picks.map((id) => byId.get(id)).filter((c): c is MapContact => c != null);

  return (
    <section className="absolute inset-x-0 bottom-0 z-10 flex max-h-[75dvh] flex-col rounded-t-2xl bg-white text-neutral-900 shadow-[0_-8px_30px_rgba(0,0,0,0.15)] md:inset-y-3 md:left-auto md:right-3 md:max-h-none md:w-[26rem] md:rounded-2xl">
      <header className="flex items-center gap-2 border-b border-neutral-100 px-4 pb-3 pt-4">
        <h2 className="text-lg font-semibold">Plan</h2>
        <input
          type="date"
          value={plan.date}
          onChange={(e) => e.target.value && plan.setDate(e.target.value)}
          className={`${input} flex-1`}
        />
        <button onClick={onClose} className="rounded-full bg-neutral-100 px-2.5 py-1 text-sm" aria-label="Close">
          ✕
        </button>
      </header>

      <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {view === "pick" ? (
          <ContactPicker plan={plan} contacts={contacts} onDone={() => setView("edit")} />
        ) : plan.result ? (
          <RouteView plan={plan} onOpenContact={onOpenContact} />
        ) : (
          <>
            <SettingsBlock plan={plan} />

            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">Fixed · {formatDay(plan.date)}</h3>
              {dayMeetings.length === 0 ? (
                <p className="text-sm text-neutral-500">No meetings this day.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {dayMeetings.map((m) => (
                    <li key={m.id} className="flex gap-2 rounded-lg bg-amber-50 px-2 py-1.5">
                      <span className="w-16 shrink-0 tabular-nums">{formatTime(m.starts_at)}</span>
                      <span className="truncate">
                        {m.type === "call" ? "📞 " : ""}
                        {byId.get(m.contact_id)?.name ?? "Meeting"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Stops to fit in · {picked.length}</h3>
                <button onClick={() => setView("pick")} className="text-sm font-medium text-blue-600">＋ Add</button>
              </div>
              {picked.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Add contacts here, or tap <strong>＋ Plan</strong> on a contact or in Nearby.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {picked.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 border-b border-neutral-100 py-1.5 text-sm last:border-0">
                      <Dot category={c.category} />
                      <button onClick={() => onOpenContact(c.id)} className="min-w-0 flex-1 truncate text-left">
                        {c.name}
                        <span className="text-neutral-500"> · {PRIORITY_LABELS[c.priority]}</span>
                        {c.map_lat == null && <span className="text-amber-700"> · no location</span>}
                      </button>
                      <button onClick={() => plan.toggle(c.id)} className="px-1 text-neutral-400" aria-label={`Remove ${c.name}`}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {plan.error && <p className="text-sm text-red-600">{plan.error}</p>}
            <button
              onClick={plan.optimize}
              disabled={plan.optimizing || !plan.settings || (picked.length === 0 && dayMeetings.length === 0)}
              className="rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-40"
            >
              {plan.optimizing ? "Finding the best route…" : !plan.settings ? "Pick a start point first" : "Plan route"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function SettingsBlock({ plan }: { plan: DayPlanState }) {
  const [adding, setAdding] = useState(plan.places.length === 0);
  const [locating, setLocating] = useState(false);
  const s = plan.settings;
  const startValue = s?.start.here ? "here" : plan.places.find((p) => p.lat === s?.start.lat && p.lng === s?.start.lng)?.id ?? "";

  function chooseStart(value: string) {
    if (value === "add") return setAdding(true);
    if (value === "here") {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          plan.updateSettings({ start: { name: "My location", lat: pos.coords.latitude, lng: pos.coords.longitude, here: true } });
        },
        () => setLocating(false),
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }
    const place = plan.places.find((p) => p.id === value);
    if (place) plan.updateSettings({ start: { name: place.name, lat: place.lat, lng: place.lng } });
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-neutral-500">Start</span>
        <select value={startValue} onChange={(e) => chooseStart(e.target.value)} className={`${input} min-w-0 flex-1`}>
          {!s && <option value="">Choose…</option>}
          {plan.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="here">{locating ? "Finding you…" : "My location"}</option>
          <option value="add">＋ Add hotel / place…</option>
        </select>
      </label>
      {adding && <AddPlaceForm plan={plan} onDone={() => setAdding(false)} />}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-neutral-500">Hours</span>
        <input type="time" value={s?.dayStart ?? "09:00"} onChange={(e) => plan.updateSettings({ dayStart: e.target.value })} className={input} />
        <span>–</span>
        <input type="time" value={s?.dayEnd ?? "18:00"} onChange={(e) => plan.updateSettings({ dayEnd: e.target.value })} className={input} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-neutral-500">Per stop</span>
          <select value={s?.dwellMin ?? 20} onChange={(e) => plan.updateSettings({ dwellMin: Number(e.target.value) })} className={input}>
            {[10, 15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={s?.returnToStart ?? true}
            onChange={(e) => plan.updateSettings({ returnToStart: e.target.checked })}
          />
          End back at start
        </label>
      </div>
    </div>
  );
}

function AddPlaceForm({ plan, onDone }: { plan: DayPlanState; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-2"
      action={(form) =>
        start(async () => {
          const res = await addPlace(String(form.get("name")), String(form.get("address")), true);
          if (res.error || !res.place) return setError(res.error ?? "Couldn't save.");
          plan.addPlaceLocally(res.place);
          plan.updateSettings({ start: { name: res.place.name, lat: res.place.lat, lng: res.place.lng } });
          onDone();
        })
      }
    >
      <input name="name" placeholder="Name (e.g. Hotel)" defaultValue="Hotel" className={input} />
      <input name="address" required placeholder="Address" className={input} />
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={pending} className="flex-1 rounded-lg bg-neutral-900 py-2 text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save as default start"}
        </button>
        {plan.places.length > 0 && (
          <button type="button" onClick={onDone} className="px-2 text-neutral-500">Cancel</button>
        )}
      </div>
    </form>
  );
}

function ContactPicker({ plan, contacts, onDone }: { plan: DayPlanState; contacts: MapContact[]; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter((c) => c.map_lat != null)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.company_name?.toLowerCase().includes(q))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name));
  }, [contacts, query]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className={`${input} flex-1`} />
        <button onClick={onDone} className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white">Done</button>
      </div>
      <ul className="flex flex-col">
        {rows.map((c) => {
          const on = plan.has(c.id);
          return (
            <li key={c.id}>
              <button
                onClick={() => plan.toggle(c.id)}
                className="flex w-full items-center gap-2 border-b border-neutral-100 py-2 text-left text-sm"
              >
                <span className={`flex size-5 items-center justify-center rounded border ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}>
                  {on && "✓"}
                </span>
                <Dot category={c.category} />
                <span className="min-w-0 flex-1 truncate">
                  {c.name}
                  {c.company_name && <span className="text-neutral-500"> · {c.company_name}</span>}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">{PRIORITY_LABELS[c.priority]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RouteView({ plan, onOpenContact }: { plan: DayPlanState; onOpenContact: (id: string) => void }) {
  const r = plan.result!;
  const links = googleMapsLinks(r.stops, Boolean(plan.settings?.start.here));
  let n = 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <p className="text-neutral-600">
          {r.stops.filter((s) => s.kind === "contact" || s.kind === "meeting").length} stops · {r.totalDriveMin} min driving
        </p>
        <button onClick={plan.clearResult} className="font-medium text-blue-600">Edit stops</button>
      </div>

      {r.warnings.map((w) => (
        <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">⚠️ {w}</p>
      ))}

      <div className="flex flex-col gap-2">
        {links.map((l, i) => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-neutral-900 py-3 text-center text-sm font-medium text-white"
          >
            🧭 Open in Google Maps{links.length > 1 ? ` · part ${i + 1} of ${links.length}` : ""}
          </a>
        ))}
      </div>

      <ol className="flex flex-col">
        {r.stops.map((s, i) => {
          const numbered = s.kind === "contact" || s.kind === "meeting";
          if (numbered) n++;
          return (
            <li key={`${s.kind}-${s.contactId ?? i}`} className="flex gap-3 border-b border-neutral-100 py-2 text-sm last:border-0">
              <span className="w-16 shrink-0 tabular-nums text-neutral-600">
                {s.kind === "meeting" && s.startsAt
                  ? formatTime(s.startsAt)
                  : s.arrive ? formatTime(s.arrive) : s.depart ? formatTime(s.depart) : ""}
              </span>
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  s.kind === "meeting" ? "bg-amber-400 text-neutral-900" : numbered ? "bg-neutral-900 text-white" : "bg-neutral-200"
                }`}
              >
                {numbered ? n : s.kind === "start" ? "▶" : "■"}
              </span>
              <button
                disabled={!s.contactId}
                onClick={() => s.contactId && onOpenContact(s.contactId)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate font-medium">
                  {s.kind === "meeting" ? "Meeting: " : ""}
                  {s.name}
                </span>
                <span className="block text-xs text-neutral-500">
                  {s.driveMin != null && s.driveMin > 0 && `${s.driveMin} min drive`}
                  {s.kind === "meeting" && s.arrive && ` · arrive ${formatTime(s.arrive)}`}
                  {s.kind === "meeting" && s.depart && ` · until ${formatTime(s.depart)}`}
                  {s.late && <span className="font-medium text-red-600"> · late</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {r.dropped.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">Didn&apos;t fit</h3>
          {r.dropped.map((d) => (
            <p key={d.contactId} className="text-neutral-600">
              {d.name} <span className="text-neutral-400">· {d.reason}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
