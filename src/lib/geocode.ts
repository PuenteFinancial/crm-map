import type { GeocodeConfidence } from "./types";

// Bias results toward LA without excluding contacts elsewhere.
const LA_PROXIMITY = "-118.2437,34.0522";

export type GeocodeResult = {
  lat: number;
  lng: number;
  confidence: GeocodeConfidence;
  placeName: string;
};

type MatchLevel = "matched" | "unmatched" | "plausible" | "inferred" | "not_applicable";

type MapboxFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    feature_type: string;
    full_address?: string;
    name?: string;
    match_code?: {
      confidence?: "exact" | "high" | "medium" | "low";
      address_number?: MatchLevel;
      street?: MatchLevel;
    };
  };
};

export function geocodingEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
}

// Mapbox Geocoding v6. Returns null when there's no token or no match.
export async function geocode(query: string): Promise<GeocodeResult | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const q = query.trim();
  if (!token || !q) return null;

  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "1");
  url.searchParams.set("proximity", LA_PROXIMITY);
  url.searchParams.set("access_token", token);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox geocoding failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { features: MapboxFeature[] };
  const feature = body.features[0];
  if (!feature) return null;

  const [lng, lat] = feature.geometry.coordinates;
  return {
    lat,
    lng,
    confidence: toConfidence(feature, q),
    placeName: feature.properties.full_address ?? feature.properties.name ?? q,
  };
}

const GENERIC_STREET_WORDS = new Set([
  "street", "road", "avenue", "boulevard", "drive", "lane", "place", "court", "way", "highway",
  "north", "south", "east", "west",
]);

// Mapbox sometimes answers a street it can't find with some other street. Only trust a
// street-level result if a distinctive word of its name appears in what was searched.
function streetNameMatches(name: string | undefined, query: string) {
  if (!name) return false;
  const q = query.toLowerCase();
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_STREET_WORDS.has(w));
  return words.some((w) => q.includes(w));
}

function toConfidence(feature: MapboxFeature, query: string): GeocodeConfidence {
  const { feature_type: type, match_code: match, name } = feature.properties;
  switch (type) {
    case "address":
      // A "plausible" house number on a matched street is placed by interpolation along that
      // street, so it's close enough to drive to even though Mapbox rates the match low.
      if (match?.street === "unmatched") return "low";
      if (match?.address_number === "matched" && match.confidence !== "low") return "exact";
      return "street";
    case "street":
      return streetNameMatches(name, query) && match?.confidence !== "low" ? "street" : "low";
    case "neighborhood":
    case "locality":
    case "place":
    case "postcode":
      return match?.confidence === "low" ? "low" : "city";
    default: // district, region, country
      return "low";
  }
}

export function isDrivable(confidence: GeocodeConfidence | null | undefined) {
  return confidence === "exact" || confidence === "street" || confidence === "manual";
}
