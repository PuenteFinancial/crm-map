import { distanceMeters } from "./contacts";
import type { Priority } from "./types";

// Day planning around fixed meetings.
//
// Mapbox can order stops but has no notion of "be at X by 2pm", so meetings split the day
// into gaps (start → meeting 1 → meeting 2 → … → end). Each picked contact goes into the gap
// where it adds the least detour, each gap is ordered on its own, and when a gap can't fit
// its stops before the next meeting, the lowest-priority stops are dropped until it does.

export type LatLng = { lat: number; lng: number };

export type PlanSettings = {
  start: { name: string; lat: number; lng: number; here?: boolean };
  /** LA wall-clock "HH:mm" */
  dayStart: string;
  dayEnd: string;
  /** Minutes spent at each drop-in stop. */
  dwellMin: number;
  returnToStart: boolean;
};

export type PlanMeeting = LatLng & {
  id: string;
  contactId: string;
  name: string;
  startsAt: string;
  endsAt: string;
};

export type PlanContact = LatLng & { id: string; name: string; priority: Priority };

export type RouteStop = LatLng & {
  kind: "start" | "meeting" | "contact" | "end";
  name: string;
  /** Contact id for meeting/contact stops. */
  contactId?: string;
  visitId?: string;
  arrive?: string;
  depart?: string;
  /** Drive time from the previous stop. */
  driveMin?: number;
  /** Meeting start time (meeting stops only). */
  startsAt?: string;
  /** Arrives after the meeting starts. */
  late?: boolean;
};

export type PlanResult = {
  stops: RouteStop[];
  dropped: { contactId: string; name: string; reason: string }[];
  warnings: string[];
  geometry: [number, number][];
  totalDriveMin: number;
  computedAt: string;
};

/** Order for the middle points of one gap, plus drive seconds for each leg (from → … → to). */
export type SegmentRouter = (
  from: LatLng,
  middle: LatLng[],
  to: LatLng | null,
) => Promise<{ order: number[]; legSeconds: number[] }>;

/** Drive time and road geometry along already-ordered points. */
export type PathRouter = (points: LatLng[]) => Promise<{ legSeconds: number[]; geometry: [number, number][] }>;

const PRIORITY_RANK: Record<Priority, number> = { "must-see": 0, "want-to-see": 1, "if-nearby": 2 };

function detour(a: LatLng, c: LatLng, b: LatLng | null) {
  return b ? distanceMeters(a, c) + distanceMeters(c, b) - distanceMeters(a, b) : distanceMeters(a, c);
}

const minutes = (ms: number) => ms / 60000;

type Anchor = LatLng & {
  kind: "start" | "meeting" | "end";
  name: string;
  meeting?: PlanMeeting;
  /** Must arrive by (ms). */
  arriveBy?: number;
  /** Earliest departure (ms). */
  departAt: number;
};

export async function planDay(
  input: {
    dayStartIso: string;
    dayEndIso: string;
    settings: PlanSettings;
    meetings: PlanMeeting[];
    contacts: PlanContact[];
  },
  routeSegment: SegmentRouter,
  routePath: PathRouter,
): Promise<PlanResult> {
  const { settings } = input;
  const dayStart = Date.parse(input.dayStartIso);
  const dayEnd = Date.parse(input.dayEndIso);
  const dwell = settings.dwellMin * 60000;
  const warnings: string[] = [];
  const dropped: PlanResult["dropped"] = [];

  const meetings = [...input.meetings].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const anchors: Anchor[] = [
    { kind: "start", name: settings.start.name, lat: settings.start.lat, lng: settings.start.lng, departAt: dayStart },
    ...meetings.map<Anchor>((m) => ({
      kind: "meeting",
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      meeting: m,
      arriveBy: Date.parse(m.startsAt),
      departAt: Date.parse(m.endsAt),
    })),
  ];
  if (settings.returnToStart) {
    anchors.push({ kind: "end", name: settings.start.name, lat: settings.start.lat, lng: settings.start.lng, arriveBy: dayEnd, departAt: dayEnd });
  }

  // Gap i runs from anchors[i] to anchors[i + 1] (or open-ended after the last anchor).
  const gapCount = settings.returnToStart ? anchors.length - 1 : anchors.length;
  const gaps: PlanContact[][] = Array.from({ length: gapCount }, () => []);
  const meetingContacts = new Set(meetings.map((m) => m.contactId));

  const gapEnd = (g: number) => anchors[g + 1] ?? null;

  // Gaps ranked for a contact: least detour first; within ~1 km, the earlier gap wins so idle
  // time before a meeting gets used (anything that doesn't fit moves on to a later gap).
  function rankGaps(c: PlanContact, fromGap: number) {
    const options = [];
    for (let g = fromGap; g < gapCount; g++) options.push({ g, cost: detour(anchors[g], c, gapEnd(g)) });
    return options
      .sort((a, b) => (Math.abs(a.cost - b.cost) < 1000 ? a.g - b.g : a.cost - b.cost))
      .map((o) => o.g);
  }

  for (const c of input.contacts) {
    if (meetingContacts.has(c.id)) continue; // already on the schedule as a meeting
    gaps[rankGaps(c, 0)[0]].push(c);
  }

  // Least-detour placement ignores time, so an hour before a 10am meeting can sit empty while
  // nearby stops pile up in the afternoon. Pull stops forward into gaps with spare time, judged by
  // a rough straight-line estimate; the real routing below bumps anything that doesn't fit.
  const ROAD_FACTOR = 1.4; // road distance vs straight line in LA
  const AVG_SPEED = 8; // m/s, about 18 mph: err slow so the estimate rarely overfills a gap
  const estMs = (g: number, stops: PlanContact[]) => {
    const to = gapEnd(g);
    const base = to ? distanceMeters(anchors[g], to) : 0;
    const meters = base + stops.reduce((s, c) => s + detour(anchors[g], c, to), 0);
    return (meters * ROAD_FACTOR) / AVG_SPEED * 1000 + dwell * stops.length;
  };
  const gapAvailable = (g: number) => (gapEnd(g)?.arriveBy ?? dayEnd) - anchors[g].departAt;
  const leastImportant = (g: number) =>
    [...gaps[g]].sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        detour(anchors[g], b, gapEnd(g)) - detour(anchors[g], a, gapEnd(g)),
    )[0];
  for (let g = 0; g < gapCount; g++) {
    // First move out what clearly won't fit (least important first), so it can't block the
    // nearer stops that would.
    while (gaps[g].length > 0 && estMs(g, gaps[g]) > gapAvailable(g)) {
      const victim = leastImportant(g);
      const later = rankGaps(victim, g + 1)[0];
      if (later === undefined) break; // last gap: the routing below drops what doesn't fit
      gaps[g] = gaps[g].filter((c) => c !== victim);
      gaps[later].push(victim);
    }
    if (g === gapCount - 1) break;
    // Then fill spare time with the stops that add the least driving.
    for (;;) {
      let best: { from: number; c: PlanContact; extra: number } | null = null;
      for (let h = g + 1; h < gapCount; h++) {
        for (const c of gaps[h]) {
          const extra = detour(anchors[g], c, gapEnd(g)) - detour(anchors[h], c, gapEnd(h));
          // Only worth it when it fits and doesn't add much driving compared to where it is now.
          if (extra < 8000 && (!best || extra < best.extra) && estMs(g, [...gaps[g], c]) <= gapAvailable(g)) {
            best = { from: h, c, extra };
          }
        }
      }
      if (!best) break;
      gaps[best.from] = gaps[best.from].filter((x) => x !== best!.c);
      gaps[g].push(best.c);
    }
  }

  // Order each gap in turn. A stop that doesn't fit before the next fixed time moves to its
  // best later gap; it's only dropped when no later gap is left.
  const ordered: { anchor: Anchor; stops: PlanContact[] }[] = [];
  for (let g = 0; g < gapCount; g++) {
    const from = anchors[g];
    const to = gapEnd(g);
    const available = (to?.arriveBy ?? dayEnd) - from.departAt;
    let stops = gaps[g];
    let order: number[] = [];

    while (stops.length > 0) {
      const res = await routeSegment(from, stops, to);
      order = res.order;
      const needed = res.legSeconds.reduce((s, x) => s + x * 1000, 0) + dwell * stops.length;
      if (needed <= available) break;

      // Bump the least important stop: lowest priority, then the biggest detour.
      const victim = [...stops].sort(
        (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || detour(from, b, to) - detour(from, a, to),
      )[0];
      stops = stops.filter((s) => s !== victim);
      order = [];
      const later = rankGaps(victim, g + 1)[0];
      if (later !== undefined) {
        gaps[later].push(victim);
      } else {
        dropped.push({
          contactId: victim.id,
          name: victim.name,
          reason: to?.kind === "meeting" ? `No time before ${to.name}` : "No time left in the day",
        });
      }
    }
    ordered.push({ anchor: from, stops: order.map((i) => stops[i]) });
  }
  if (settings.returnToStart) ordered.push({ anchor: anchors[anchors.length - 1], stops: [] });

  // Final drive times and road geometry along the whole day, in one pass.
  const sequence: (Anchor | PlanContact)[] = ordered.flatMap((o) => [o.anchor, ...o.stops]);
  const path = await routePath(sequence);

  const stops: RouteStop[] = [];
  let clock = dayStart;
  let totalDrive = 0;
  sequence.forEach((p, i) => {
    const driveMs = i === 0 ? 0 : path.legSeconds[i - 1] * 1000;
    totalDrive += driveMs;
    const arrive = clock + driveMs;

    if ("kind" in p && p.kind === "start") {
      stops.push({ kind: "start", name: p.name, lat: p.lat, lng: p.lng, depart: new Date(dayStart).toISOString() });
      clock = dayStart;
    } else if ("kind" in p && p.kind === "meeting") {
      const m = p.meeting!;
      const late = arrive > Date.parse(m.startsAt) + 60000;
      if (late) warnings.push(`You'd reach ${m.name} about ${Math.round(minutes(arrive - Date.parse(m.startsAt)))} min late.`);
      stops.push({
        kind: "meeting", name: m.name, contactId: m.contactId, visitId: m.id, lat: p.lat, lng: p.lng, startsAt: m.startsAt,
        arrive: new Date(arrive).toISOString(), depart: m.endsAt, driveMin: Math.round(minutes(driveMs)), late,
      });
      clock = Math.max(Date.parse(m.endsAt), arrive);
    } else if ("kind" in p && p.kind === "end") {
      stops.push({ kind: "end", name: p.name, lat: p.lat, lng: p.lng, arrive: new Date(arrive).toISOString(), driveMin: Math.round(minutes(driveMs)) });
      clock = arrive;
    } else {
      const c = p as PlanContact;
      stops.push({
        kind: "contact", name: c.name, contactId: c.id, lat: c.lat, lng: c.lng,
        arrive: new Date(arrive).toISOString(), depart: new Date(arrive + dwell).toISOString(), driveMin: Math.round(minutes(driveMs)),
      });
      clock = arrive + dwell;
    }
  });

  if (clock > dayEnd + 60000) warnings.push("The day runs past your end time.");

  return {
    stops,
    dropped,
    warnings,
    geometry: path.geometry,
    totalDriveMin: Math.round(minutes(totalDrive)),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Google Maps directions links for the route. One link holds an origin, a destination and up to
 * 9 waypoints, so longer days are split into legs that pick up where the previous one ended.
 * When starting from "here", the first link leaves out the origin so Google uses your location.
 */
export function googleMapsLinks(stops: RouteStop[], startHere: boolean) {
  const points = stops.map((s) => `${s.lat},${s.lng}`);
  const links: { label: string; url: string }[] = [];
  const PER_LINK = 10; // origin + 9 waypoints; the destination starts the next link
  for (let i = 0; i < points.length - 1; i += PER_LINK) {
    const chunk = points.slice(i, i + PER_LINK + 1);
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    if (!(i === 0 && startHere)) url.searchParams.set("origin", chunk[0]);
    url.searchParams.set("destination", chunk[chunk.length - 1]);
    if (chunk.length > 2) url.searchParams.set("waypoints", chunk.slice(1, -1).join("|"));
    url.searchParams.set("travelmode", "driving");
    links.push({ label: `${stops[i].name} → ${stops[Math.min(i + PER_LINK, stops.length - 1)].name}`, url: url.toString() });
  }
  return links;
}
