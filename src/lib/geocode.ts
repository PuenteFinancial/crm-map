import type { GeocodeConfidence } from "./types";

// Bias results toward LA without excluding contacts elsewhere.
const LA_PROXIMITY = "-118.2437,34.0522";

export type GeocodeResult = {
  lat: number;
  lng: number;
  confidence: GeocodeConfidence;
  placeName: string;
};

type MapboxFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    feature_type: string;
    full_address?: string;
    name?: string;
    match_code?: { confidence?: "exact" | "high" | "medium" | "low" };
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
    confidence: toConfidence(feature),
    placeName: feature.properties.full_address ?? feature.properties.name ?? q,
  };
}

function toConfidence(feature: MapboxFeature): GeocodeConfidence {
  const match = feature.properties.match_code?.confidence;
  if (match === "low") return "low";
  switch (feature.properties.feature_type) {
    case "address":
      return match === "medium" ? "street" : "exact";
    case "street":
      return "street";
    case "neighborhood":
    case "locality":
    case "place":
    case "postcode":
      return "city";
    default: // district, region, country
      return "low";
  }
}

export function isDrivable(confidence: GeocodeConfidence | null | undefined) {
  return confidence === "exact" || confidence === "street" || confidence === "manual";
}
