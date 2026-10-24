"use client";

import type { MapContact, Meeting } from "@/lib/contacts";
import { dayKey, formatDay, formatTime, nowWallTime } from "@/lib/time";

type Props = {
  meetings: Meeting[];
  contacts: Map<string, MapContact>;
  onOpen: (contactId: string) => void;
  onNearby: (meeting: Meeting) => void;
  onClose: () => void;
};

export function meetingLocation(m: Meeting, contact: MapContact | undefined) {
  if (m.lat != null && m.lng != null) return { lat: m.lat, lng: m.lng };
  if (contact?.map_lat != null && contact.map_lng != null) return { lat: contact.map_lat, lng: contact.map_lng };
  return null;
}

export function AgendaPanel({ meetings, contacts, onOpen, onNearby, onClose }: Props) {
  const today = nowWallTime().slice(0, 10);
  const days = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = dayKey(m.starts_at);
    days.set(key, [...(days.get(key) ?? []), m]);
  }

  return (
    <div className="pointer-events-auto flex max-h-[70dvh] flex-col gap-3 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-3 text-neutral-900 shadow-lg md:max-w-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium">Upcoming meetings</p>
        <button onClick={onClose} className="text-sm text-neutral-500">Close</button>
      </div>
      {meetings.length === 0 && (
        <p className="text-sm text-neutral-500">None yet. Open a contact and tap Schedule.</p>
      )}
      {[...days].map(([key, list]) => (
        <div key={key} className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {key === today ? "Today" : formatDay(key)}
          </p>
          <ul className="flex flex-col">
            {list.map((m) => {
              const c = contacts.get(m.contact_id);
              const place = meetingLocation(m, c);
              return (
                <li key={m.id} className="flex items-center gap-2 border-b border-neutral-100 py-2 last:border-0">
                  <span className="w-16 shrink-0 text-sm tabular-nums text-neutral-600">{formatTime(m.starts_at)}</span>
                  <button onClick={() => onOpen(m.contact_id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium">
                      {m.type === "call" ? "📞 " : ""}
                      {c?.name ?? "Unknown contact"}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">
                      {[c?.company_name, m.address].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  {m.type !== "call" && place && (
                    <button onClick={() => onNearby(m)} className="shrink-0 text-sm text-blue-600">Nearby</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
