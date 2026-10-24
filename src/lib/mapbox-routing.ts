import { distanceMeters } from "./contacts";
import type { LatLng, PathRouter, SegmentRouter } from "./route";

const PROFILE = "mapbox/driving-traffic";
const OPTIMIZE_MAX = 12; // Optimization API v1 coordinate limit
const DIRECTIONS_MAX = 25;

function token() {
  const t = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!t) throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN is not set");
  return t;
}

const coords = (points: LatLng[]) => points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

async function mapbox<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://api.mapbox.com/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token());
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.code !== "Ok") throw new Error(`Mapbox routing failed: ${body.message ?? body.code ?? res.status}`);
  return body as T;
}

type DirectionsResponse = { routes: { legs: { duration: number }[]; geometry: { coordinates: [number, number][] } }[] };

export const routePath: PathRouter = async (points) => {
  if (points.length < 2) return { legSeconds: [], geometry: [] };
  const legSeconds: number[] = [];
  const geometry: [number, number][] = [];
  // Chunks share their boundary point so legs line up.
  for (let i = 0; i < points.length - 1; i += DIRECTIONS_MAX - 1) {
    const chunk = points.slice(i, i + DIRECTIONS_MAX);
    const body = await mapbox<DirectionsResponse>(`directions/v5/${PROFILE}/${coords(chunk)}`, {
      geometries: "geojson",
      overview: "full",
    });
    const route = body.routes[0];
    legSeconds.push(...route.legs.map((l) => l.duration));
    geometry.push(...route.geometry.coordinates);
  }
  return { legSeconds, geometry };
};

type OptimizationResponse = {
  waypoints: { waypoint_index: number }[];
  trips: { legs: { duration: number }[] }[];
};

// Greedy nearest-neighbour order, for gaps with more stops than the optimizer takes.
function nearestNeighbour(from: LatLng, middle: LatLng[]) {
  const left = middle.map((_, i) => i);
  const order: number[] = [];
  let here = from;
  while (left.length) {
    left.sort((a, b) => distanceMeters(here, middle[a]) - distanceMeters(here, middle[b]));
    const next = left.shift()!;
    order.push(next);
    here = middle[next];
  }
  return order;
}

export const routeSegment: SegmentRouter = async (from, middle, to) => {
  const points = [from, ...middle, ...(to ? [to] : [])];

  if (middle.length <= 1 || points.length > OPTIMIZE_MAX) {
    const order = middle.length <= 1 ? middle.map((_, i) => i) : nearestNeighbour(from, middle);
    const path = await routePath([from, ...order.map((i) => middle[i]), ...(to ? [to] : [])]);
    return { order, legSeconds: path.legSeconds };
  }

  // With a fixed end: from → … → to. Open-ended: ask for a round trip from `from` and drop the drive back.
  const body = await mapbox<OptimizationResponse>(`optimized-trips/v1/${PROFILE}/${coords(points)}`, to
    ? { source: "first", destination: "last", roundtrip: "false" }
    : { source: "first", roundtrip: "true" });
  const order = middle
    .map((_, i) => i)
    .sort((a, b) => body.waypoints[a + 1].waypoint_index - body.waypoints[b + 1].waypoint_index);
  const legs = body.trips[0].legs.map((l) => l.duration);
  return { order, legSeconds: to ? legs : legs.slice(0, -1) };
};
