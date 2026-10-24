"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CATEGORY_LABELS, PRIORITY_LABELS, type MapContact, type Meeting } from "@/lib/contacts";
import { CATEGORIES, PRIORITIES, type Category, type Owner, type Priority } from "@/lib/types";
import { signOut } from "../login/actions";
import { setPin } from "./actions";
import { AgendaPanel, meetingLocation } from "./agenda-panel";
import { ContactSheet } from "./contact-sheet";
import { ListView } from "./list-view";
import { NearbySheet, type NearbyAnchor } from "./nearby-sheet";
import { PlanSheet } from "./plan-sheet";
import { useDayPlan } from "./use-day-plan";
import { Dot } from "./ui";

// mapbox-gl touches window on import.
const MapView = dynamic(() => import("./map-view"), { ssr: false });

type Filters = {
  categories: Set<Category>;
  priorities: Set<Priority>;
  owner: Owner | "all";
  notVisited: boolean;
};

const ALL_FILTERS: Filters = {
  categories: new Set(CATEGORIES),
  priorities: new Set(PRIORITIES),
  owner: "all",
  notVisited: false,
};

type MapAppProps = {
  contacts: MapContact[];
  meetings: Meeting[];
  me: Owner | null;
  initialSelectedId: string | null;
};

export function MapApp({ contacts, meetings, me, initialSelectedId }: MapAppProps) {
  const [selectedId, setSelectedIdState] = useState<string | null>(initialSelectedId);
  const [filters, setFilters] = useState<Filters>(ALL_FILTERS);
  const [query, setQuery] = useState("");
  const [panel, setPanelState] = useState<"none" | "filters" | "needs" | "menu" | "agenda">("none");
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyAnchor | null>(null);
  const [nearbyByPriority, setNearbyByPriority] = useState(false);
  const [locating, setLocating] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const plan = useDayPlan();
  const [saving, startSaving] = useTransition();

  // Keep ?c= in the URL so a selected contact survives reloads and can be shared between you two.
  function setSelectedId(id: string | null) {
    setSelectedIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }

  // On phones a panel and the contact sheet would overlap, so opening one closes the other.
  function setPanel(next: typeof panel) {
    setPanelState(next);
    if (next !== "none" && window.innerWidth < 768) setSelectedId(null);
  }

  const visible = useMemo(
    () =>
      contacts.filter(
        (c) =>
          filters.categories.has(c.category) &&
          filters.priorities.has(c.priority) &&
          (filters.owner === "all" || c.owner === filters.owner) &&
          (!filters.notVisited || c.last_visit_at == null),
      ),
    [contacts, filters],
  );

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? visible.filter((c) => c.name.toLowerCase().includes(q) || c.company_name?.toLowerCase().includes(q)) : visible;
  }, [visible, query]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    // In the list, the search box filters the list itself.
    if (!q || listOpen) return [];
    return contacts
      .filter((c) => c.name.toLowerCase().includes(q) || c.company_name?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [contacts, query, listOpen]);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const needsPin = contacts.filter((c) => c.needs_review);
  const selected = contacts.find((c) => c.id === selectedId) ?? null;
  const placing = contacts.find((c) => c.id === placingId) ?? null;
  const activeFilterCount =
    CATEGORIES.length - filters.categories.size +
    (PRIORITIES.length - filters.priorities.size) +
    (filters.owner === "all" ? 0 : 1) +
    (filters.notVisited ? 1 : 0);

  function toggle<T>(set: Set<T>, value: T) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function showNearby(anchor: Omit<NearbyAnchor, "radiusMi">) {
    setNearby({ ...anchor, radiusMi: nearby?.radiusMi ?? 3 });
    setSelectedId(null);
    setPanelState("none");
  }

  function nearContact(c: MapContact) {
    if (c.map_lat == null || c.map_lng == null) return;
    showNearby({ label: c.name, lat: c.map_lat, lng: c.map_lng, contactId: c.id });
  }

  function nearMeeting(m: Meeting) {
    const c = byId.get(m.contact_id);
    const place = meetingLocation(m, c);
    if (!place) return;
    showNearby({ label: `meeting with ${c?.name ?? "contact"}`, ...place, contactId: m.contact_id });
  }

  function nearMe() {
    if (!navigator.geolocation) return setLocating("This browser can't share location.");
    setLocating("Finding you…");
    setPanelState("none");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(null);
        showNearby({ label: "you", lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => setLocating(err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handlePlace(lat: number, lng: number) {
    if (!placingId) return;
    const id = placingId;
    startSaving(async () => {
      await setPin(id, lat, lng);
      setPlacingId(null);
      setSelectedId(id);
    });
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <MapView
        contacts={visible}
        selectedId={selectedId}
        nearby={nearby}
        route={planOpen ? plan.result : null}
        placing={placing != null}
        onSelect={(id) => {
          setSelectedId(id);
          setPanel("none");
        }}
        onPlace={handlePlace}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={listOpen ? "Search list" : `Search ${contacts.length} contacts`}
              className="w-full rounded-xl border border-neutral-200 bg-white/95 px-3 py-2.5 text-[16px] text-neutral-900 shadow-sm backdrop-blur"
            />
            {searchResults.length > 0 && (
              <ul className="absolute inset-x-0 top-full mt-1 overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-lg">
                {searchResults.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => {
                        setSelectedId(c.id);
                        setQuery("");
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-50"
                    >
                      <Dot category={c.category} />
                      <span className="flex-1 truncate">
                        {c.name}
                        {c.company_name && <span className="text-neutral-500"> · {c.company_name}</span>}
                      </span>
                      {c.map_lat == null && <span className="text-xs text-amber-700">no pin</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <BarButton
            active={listOpen}
            onClick={() => {
              setListOpen(!listOpen);
              setPanelState("none");
              setSelectedId(null);
              setPlanOpen(false);
              setNearby(null);
            }}
          >
            {listOpen ? "Map" : "List"}
          </BarButton>
          <BarButton active={panel === "filters" || activeFilterCount > 0} onClick={() => setPanel(panel === "filters" ? "none" : "filters")}>
            Filter{activeFilterCount > 0 && ` · ${activeFilterCount}`}
          </BarButton>
          <BarButton active={panel === "menu"} onClick={() => setPanel(panel === "menu" ? "none" : "menu")} aria-label="Menu">
            ☰
          </BarButton>
        </div>

        {panel === "none" && !placing && !listOpen && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setPanel("agenda")}
              className="pointer-events-auto rounded-full bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm"
            >
              📅 {meetings.length} upcoming
            </button>
            <button
              onClick={() => {
                setPlanOpen(true);
                setNearby(null);
                setSelectedId(null);
              }}
              className="pointer-events-auto rounded-full bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm"
            >
              🗺 Plan{plan.picks.length > 0 && ` · ${plan.picks.length}`}
            </button>
            <button
              onClick={nearMe}
              className="pointer-events-auto rounded-full bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm"
            >
              ◎ Near me
            </button>
            {needsPin.length > 0 && (
              <button
                onClick={() => setPanel("needs")}
                className="pointer-events-auto rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900 shadow-sm"
              >
                📍 {needsPin.length} need a location
              </button>
            )}
          </div>
        )}
        {locating && (
          <p className="pointer-events-auto self-start rounded-full bg-neutral-900 px-3 py-1.5 text-sm text-white">
            {locating}
            {locating !== "Finding you…" && (
              <button onClick={() => setLocating(null)} className="ml-2 underline">OK</button>
            )}
          </p>
        )}

        {panel === "agenda" && (
          <AgendaPanel
            meetings={meetings}
            contacts={byId}
            onOpen={(id) => {
              setNearby(null);
              setSelectedId(id);
              setPanelState("none");
            }}
            onNearby={nearMeeting}
            onClose={() => setPanel("none")}
          />
        )}

        {panel === "filters" && (
          <Panel>
            <FilterGroup label="Category">
              {CATEGORIES.map((c) => (
                <Chip key={c} on={filters.categories.has(c)} onClick={() => setFilters({ ...filters, categories: toggle(filters.categories, c) })}>
                  <Dot category={c} /> {CATEGORY_LABELS[c]}
                </Chip>
              ))}
            </FilterGroup>
            <FilterGroup label="Priority">
              {PRIORITIES.map((p) => (
                <Chip key={p} on={filters.priorities.has(p)} onClick={() => setFilters({ ...filters, priorities: toggle(filters.priorities, p) })}>
                  {PRIORITY_LABELS[p]}
                </Chip>
              ))}
            </FilterGroup>
            <FilterGroup label="Owner">
              {(["all", "joshua", "colton"] as const).map((o) => (
                <Chip key={o} on={filters.owner === o} onClick={() => setFilters({ ...filters, owner: o })}>
                  {o === "all" ? "Everyone" : o === me ? "Mine" : o[0].toUpperCase() + o.slice(1)}
                </Chip>
              ))}
            </FilterGroup>
            <div className="flex items-center justify-between">
              <Chip on={filters.notVisited} onClick={() => setFilters({ ...filters, notVisited: !filters.notVisited })}>
                Not visited yet
              </Chip>
              <button onClick={() => setFilters(ALL_FILTERS)} className="text-sm text-neutral-500 underline">
                Reset
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Showing {visible.length} of {contacts.length}. Bigger dot = higher priority. Dark ring = visited, gold ring = meeting booked.
            </p>
          </Panel>
        )}

        {panel === "menu" && (
          <Panel>
            <Link href="/add" className="rounded-lg px-2 py-2 font-medium hover:bg-neutral-50">＋ Add contact</Link>
            <form action={signOut}>
              <button className="w-full rounded-lg px-2 py-2 text-left text-neutral-500 hover:bg-neutral-50">Sign out</button>
            </form>
          </Panel>
        )}

        {panel === "needs" && (
          <Panel>
            <div className="flex items-center justify-between">
              <p className="font-medium">Need a location</p>
              <button onClick={() => setPanel("none")} className="text-sm text-neutral-500">Close</button>
            </div>
            <ul className="-mx-1 max-h-[50dvh] overflow-y-auto">
              {needsPin.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => {
                      setSelectedId(c.id);
                      setPanel("none");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-neutral-50"
                  >
                    <Dot category={c.category} />
                    <span className="flex-1 truncate">
                      {c.name}
                      {c.company_name && <span className="text-neutral-500"> · {c.company_name}</span>}
                    </span>
                    <span className="text-xs text-neutral-500">{c.map_lat == null ? "no pin" : "rough"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {listOpen && (
        <ListView
          contacts={listed}
          total={contacts.length}
          plan={plan}
          onOpen={(id) => {
            setListOpen(false);
            setQuery("");
            setSelectedId(id);
          }}
          onOpenPlan={() => {
            setListOpen(false);
            setPlanOpen(true);
          }}
        />
      )}

      {placing && (
        <div className="absolute inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] flex items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-white shadow-lg">
          <p className="flex-1 text-sm">
            {saving ? "Saving…" : <>Tap the map where <strong>{placing.name}</strong> is.</>}
          </p>
          <button onClick={() => setPlacingId(null)} className="text-sm underline">Cancel</button>
        </div>
      )}

      {selected && !placing ? (
        <ContactSheet
          key={selected.id}
          contact={selected}
          me={me}
          onClose={() => {
            setSelectedId(null);
            setNearby(null);
          }}
          onPlacePin={() => setPlacingId(selected.id)}
          onNearby={() => {
            setPlanOpen(false);
            nearContact(selected);
          }}
          inPlan={plan.has(selected.id)}
          onTogglePlan={() => plan.toggle(selected.id)}
          onBack={nearby || planOpen ? () => setSelectedId(null) : undefined}
        />
      ) : planOpen && !placing ? (
        <PlanSheet
          plan={plan}
          contacts={contacts}
          meetings={meetings}
          onOpenContact={setSelectedId}
          onClose={() => setPlanOpen(false)}
        />
      ) : (
        nearby &&
        !placing && (
          <NearbySheet
            anchor={nearby}
            contacts={visible}
            sortByPriority={nearbyByPriority}
            onSortChange={setNearbyByPriority}
            onRadiusChange={(radiusMi) => setNearby({ ...nearby, radiusMi })}
            onSelect={setSelectedId}
            isPicked={plan.has}
            onTogglePick={plan.toggle}
            onClose={() => setNearby(null)}
          />
        )
      )}
    </div>
  );
}

function BarButton({ active, ...props }: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={`shrink-0 rounded-xl border px-3 py-2.5 text-sm font-medium shadow-sm backdrop-blur ${
        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white/95 text-neutral-900"
      }`}
    />
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-neutral-900 shadow-lg md:max-w-sm">
      {children}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, ...props }: React.ComponentProps<"button"> & { on: boolean }) {
  return (
    <button
      {...props}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
        on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-500"
      }`}
    />
  );
}
