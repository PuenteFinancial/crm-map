"use client";

import { useMemo } from "react";
import { METERS_PER_MILE, PRIORITY_LABELS, distanceMeters, type MapContact } from "@/lib/contacts";
import { BottomSheet } from "./bottom-sheet";
import { Dot } from "./ui";

export type NearbyAnchor = {
  label: string;
  lat: number;
  lng: number;
  /** The contact the anchor belongs to, left out of its own list. */
  contactId?: string;
  radiusMi: number;
};

export const RADII_MI = [0.5, 1, 3, 5, 10];

const PRIORITY_RANK = { "must-see": 0, "want-to-see": 1, "if-nearby": 2 } as const;

export function nearbyContacts(contacts: MapContact[], anchor: NearbyAnchor) {
  return contacts
    .filter((c) => c.id !== anchor.contactId && c.map_lat != null && c.map_lng != null)
    .map((c) => ({ contact: c, meters: distanceMeters(anchor, { lat: c.map_lat!, lng: c.map_lng! }) }))
    .filter((n) => n.meters <= anchor.radiusMi * METERS_PER_MILE)
    .sort((a, b) => a.meters - b.meters);
}

type Props = {
  anchor: NearbyAnchor;
  contacts: MapContact[];
  sortByPriority: boolean;
  onSortChange: (byPriority: boolean) => void;
  onRadiusChange: (mi: number) => void;
  onSelect: (id: string) => void;
  isPicked: (id: string) => boolean;
  onTogglePick: (id: string) => void;
  onClose: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export function NearbySheet(props: Props) {
  const { anchor, contacts, sortByPriority, onSortChange, onRadiusChange, onSelect, isPicked, onTogglePick, onClose } = props;
  const { collapsed, onCollapsedChange } = props;
  const rows = useMemo(() => {
    const near = nearbyContacts(contacts, anchor);
    return sortByPriority
      ? near.sort((a, b) => PRIORITY_RANK[a.contact.priority] - PRIORITY_RANK[b.contact.priority] || a.meters - b.meters)
      : near;
  }, [contacts, anchor, sortByPriority]);

  return (
    <BottomSheet
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      maxHeight="max-h-[55dvh]"
      desktopWidth="md:w-96"
      peek={
        <header className="flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-lg font-semibold leading-tight">Near {anchor.label}</h2>
            <p className="text-sm text-neutral-500">
              {rows.length} {rows.length === 1 ? "contact" : "contacts"} within {anchor.radiusMi} mi ·{" "}
              <button onClick={() => onSortChange(!sortByPriority)} className="text-blue-600">
                sorted by {sortByPriority ? "priority" : "distance"}
              </button>
            </p>
          </div>
          <button onClick={onClose} className="rounded-full bg-neutral-100 px-2.5 py-1 text-sm" aria-label="Close">
            ✕
          </button>
        </header>
      }
    >
      <div className="flex flex-col gap-3 border-b border-neutral-100 px-4 pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {RADII_MI.map((r) => (
            <button
              key={r}
              onClick={() => onRadiusChange(r)}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${
                anchor.radiusMi === r ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
              }`}
            >
              {r} mi
            </button>
          ))}
        </div>
      </div>

      <ul className="overflow-y-auto px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {rows.length === 0 && (
          <li className="px-2 py-4 text-sm text-neutral-500">
            Nobody within {anchor.radiusMi} mi{anchor.radiusMi < 10 ? ". Try a wider radius." : "."}
          </li>
        )}
        {rows.map(({ contact: c, meters }) => (
          <li key={c.id} className="flex items-center gap-1">
            <button
              onClick={() => onSelect(c.id)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-neutral-50"
            >
              <Dot category={c.category} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{c.name}</span>
                <span className="truncate text-xs text-neutral-500">
                  {[c.company_name, PRIORITY_LABELS[c.priority], c.last_visit_at ? "visited" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-neutral-600">
                {(meters / METERS_PER_MILE).toFixed(meters < METERS_PER_MILE ? 1 : 0)} mi
              </span>
            </button>
            <button
              onClick={() => onTogglePick(c.id)}
              aria-label={isPicked(c.id) ? `Remove ${c.name} from plan` : `Add ${c.name} to plan`}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-sm ${
                isPicked(c.id) ? "border-green-600 bg-green-50 text-green-800" : "border-neutral-300"
              }`}
            >
              {isPicked(c.id) ? "✓" : "＋"}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
