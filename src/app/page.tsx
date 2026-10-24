import { connection } from "next/server";
import { Suspense } from "react";
import { CONTACT_COLUMNS, type MapContact, type Meeting } from "@/lib/contacts";
import { createClient } from "@/lib/supabase/server";
import type { Owner } from "@/lib/types";
import { MapApp } from "./map/map-app";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-neutral-500">Loading map…</div>}>
      <MapData searchParams={searchParams} />
    </Suspense>
  );
}

async function MapData({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  // getClaims() checks token expiry against the clock, so this must render per request.
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();

  const [contactsRes, visitsRes, meetingsRes, meRes] = await Promise.all([
    supabase.from("contacts_located").select(CONTACT_COLUMNS).order("name"),
    supabase.from("visits").select("contact_id, status, starts_at"),
    supabase
      .from("visits")
      .select("id, contact_id, type, starts_at, ends_at, address, lat, lng, notes")
      .eq("status", "scheduled")
      .gte("starts_at", agendaStart())
      .order("starts_at"),
    supabase.from("team_members").select("name").ilike("email", String(claims?.claims.email ?? "")).maybeSingle(),
  ]);
  if (contactsRes.error) throw contactsRes.error;
  if (visitsRes.error) throw visitsRes.error;
  if (meetingsRes.error) throw meetingsRes.error;

  const { lastVisit, nextMeeting } = rollUpVisits(visitsRes.data);

  const contacts = (contactsRes.data as unknown as Omit<MapContact, "last_visit_at" | "next_meeting_at">[]).map((c) => ({
    ...c,
    last_visit_at: lastVisit.get(c.id) ?? null,
    next_meeting_at: nextMeeting.get(c.id) ?? null,
  }));

  const selected = (await searchParams).c;
  return (
    <MapApp
      contacts={contacts}
      meetings={meetingsRes.data as Meeting[]}
      me={(meRes.data?.name as Owner | undefined) ?? null}
      initialSelectedId={typeof selected === "string" ? selected : null}
      renderedAt={renderTime()}
    />
  );
}

type VisitStub = { contact_id: string; status: string; starts_at: string | null };

// Per contact: most recent completed visit and soonest upcoming meeting.
function rollUpVisits(visits: VisitStub[]) {
  const now = Date.now();
  const lastVisit = new Map<string, string>();
  const nextMeeting = new Map<string, string>();
  for (const v of visits) {
    if (!v.starts_at) continue;
    if (v.status === "done" && v.starts_at > (lastVisit.get(v.contact_id) ?? "")) lastVisit.set(v.contact_id, v.starts_at);
    if (v.status === "scheduled" && Date.parse(v.starts_at) > now) {
      const current = nextMeeting.get(v.contact_id);
      if (!current || v.starts_at < current) nextMeeting.set(v.contact_id, v.starts_at);
    }
  }
  return { lastVisit, nextMeeting };
}

// Keep meetings from earlier today on the agenda so they can still be marked done.
function agendaStart() {
  return new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
}

// When this data was fetched, so the app can tell when it's showing a saved copy.
function renderTime() {
  return Date.now();
}
