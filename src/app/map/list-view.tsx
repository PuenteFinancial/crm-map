"use client";

import { useMemo, useState } from "react";
import { CATEGORY_LABELS, PRIORITY_LABELS, type MapContact } from "@/lib/contacts";
import { dayKey, formatDay } from "@/lib/time";
import { STAGES } from "@/lib/types";
import { Dot } from "./ui";
import type { DayPlanState } from "./use-day-plan";

type SortKey = "priority" | "name" | "company" | "stage" | "last-visit";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "stage", label: "Stage" },
  { key: "last-visit", label: "Not visited first" },
];

const PRIORITY_RANK = { "must-see": 0, "want-to-see": 1, "if-nearby": 2 } as const;
const STAGE_RANK = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<string, number>;

function compare(sort: SortKey) {
  const byName = (a: MapContact, b: MapContact) => a.name.localeCompare(b.name);
  switch (sort) {
    case "priority":
      return (a: MapContact, b: MapContact) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byName(a, b);
    case "name":
      return byName;
    case "company":
      return (a: MapContact, b: MapContact) =>
        (a.company_name ?? "￿").localeCompare(b.company_name ?? "￿") || byName(a, b);
    case "stage":
      return (a: MapContact, b: MapContact) =>
        (a.stage ? STAGE_RANK[a.stage] : -1) - (b.stage ? STAGE_RANK[b.stage] : -1) || byName(a, b);
    case "last-visit":
      return (a: MapContact, b: MapContact) =>
        (a.last_visit_at ?? "").localeCompare(b.last_visit_at ?? "") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }
}

type Props = {
  /** Already filtered by the map's filters and search. */
  contacts: MapContact[];
  total: number;
  plan: DayPlanState;
  onOpen: (id: string) => void;
  onOpenPlan: () => void;
};

export function ListView({ contacts, total, plan, onOpen, onOpenPlan }: Props) {
  const [sort, setSort] = useState<SortKey>("priority");
  const rows = useMemo(() => [...contacts].sort(compare(sort)), [contacts, sort]);
  const allShownPicked = rows.length > 0 && rows.every((c) => plan.has(c.id));

  return (
    <section className="absolute inset-x-0 bottom-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.25rem)] z-10 flex flex-col bg-white text-neutral-900">
      <div className="flex flex-col gap-2 border-b border-neutral-200 px-3 pb-2 pt-2">
        <div className="flex items-center gap-2 text-sm">
          <p className="flex-1 font-medium">
            {rows.length === total ? `${total} contacts` : `${rows.length} of ${total} contacts`}
          </p>
          <label className="flex items-center gap-1 text-neutral-500">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-[16px] text-neutral-900 md:text-sm"
            >
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-2 py-1.5 text-sm text-green-900">
          <span className="flex-1">
            Plan for{" "}
            <input
              type="date"
              value={plan.date}
              onChange={(e) => e.target.value && plan.setDate(e.target.value)}
              className="rounded border border-green-200 bg-white px-1 text-[16px] md:text-sm"
            />{" "}
            · {plan.picks.length} picked
          </span>
          <button
            onClick={() => plan.setMany(rows.map((c) => c.id), !allShownPicked)}
            disabled={rows.length === 0}
            className="shrink-0 font-medium underline disabled:opacity-40"
          >
            {allShownPicked ? "Unpick shown" : "Pick all shown"}
          </button>
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {rows.length === 0 && <li className="px-4 py-6 text-sm text-neutral-500">No contacts match the search or filters.</li>}
        {rows.map((c) => {
          const on = plan.has(c.id);
          return (
            <li key={c.id} className="flex items-stretch border-b border-neutral-100">
              <button
                onClick={() => plan.toggle(c.id)}
                aria-label={on ? `Remove ${c.name} from plan` : `Add ${c.name} to plan`}
                className="flex w-12 shrink-0 items-center justify-center"
              >
                <span
                  className={`flex size-6 items-center justify-center rounded-md border text-sm ${
                    on ? "border-green-600 bg-green-600 text-white" : "border-neutral-300"
                  }`}
                >
                  {on && "✓"}
                </span>
              </button>
              <button onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 pr-3 text-left">
                <span className="flex items-center gap-2">
                  <Dot category={c.category} />
                  <span className="truncate font-medium">{c.name}</span>
                  {c.next_meeting_at && <span className="shrink-0 text-xs text-amber-700">📅</span>}
                </span>
                <span className="truncate text-sm text-neutral-500">
                  {[c.role, c.company_name].filter(Boolean).join(" · ") || CATEGORY_LABELS[c.category]}
                </span>
                <span className="flex flex-wrap gap-x-2 text-xs text-neutral-500">
                  <span className={c.priority === "must-see" ? "font-medium text-neutral-800" : ""}>{PRIORITY_LABELS[c.priority]}</span>
                  {c.stage && <span>· {c.stage}</span>}
                  <span>· {c.last_visit_at ? `visited ${formatDay(dayKey(c.last_visit_at))}` : "not visited"}</span>
                  {c.map_lat == null && <span className="text-amber-700">· no location</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {plan.picks.length > 0 && (
        <div className="border-t border-neutral-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button onClick={onOpenPlan} className="w-full rounded-xl bg-neutral-900 py-3 font-medium text-white">
            Plan route with {plan.picks.length} {plan.picks.length === 1 ? "stop" : "stops"} →
          </button>
        </div>
      )}
    </section>
  );
}
