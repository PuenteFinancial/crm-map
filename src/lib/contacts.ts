import type { Category, GeocodeConfidence, Owner, Priority, Stage } from "./types";

// A row of the contacts_located view plus visit rollups, as the map needs it.
export type MapContact = {
  id: string;
  name: string;
  company_id: string | null;
  company_name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  category: Category;
  priority: Priority;
  stage: Stage | null;
  owner: Owner | null;
  relationship: string | null;
  source: string | null;
  notes: string | null;
  address: string | null;
  map_lat: number | null;
  map_lng: number | null;
  geocode_confidence: GeocodeConfidence | null;
  location_from_company: boolean;
  needs_review: boolean;
  last_visit_at: string | null;
  next_meeting_at: string | null;
};

export const CONTACT_COLUMNS =
  "id, name, company_id, company_name, role, email, phone, linkedin, category, priority, stage, owner, " +
  "relationship, source, notes, address, map_lat, map_lng, geocode_confidence, location_from_company, needs_review";

/**
 * Which list a contact came in with, for the List filter. Imports record their source as
 * "sheet: <name> (<detail>)" or "csv: <file>"; the name is the list.
 */
export function listName(source: string | null) {
  if (!source) return "Other";
  const imported = source.match(/^(?:sheet|csv):\s*(.+?)(?:\s*\([^)]*\))?$/i);
  if (imported) return imported[1].replace(/\.csv$/i, "");
  if (source.startsWith("search-brain")) return "Search brain";
  if (source.startsWith("claude")) return "Paste / photo";
  if (source === "quick-add") return "Quick add";
  return "Other";
}

export type Visit = {
  id: string;
  contact_id: string;
  status: "scheduled" | "done" | "skipped";
  type: "meeting" | "drop-in" | "call";
  starts_at: string | null;
  ends_at: string | null;
  who: "joshua" | "colton" | "both" | null;
  address: string | null;
  outcome: string | null;
  notes: string | null;
  next_step: string | null;
};

// A scheduled visit, for the agenda and Nearby. lat/lng is the meeting place,
// falling back to the contact's location when no separate address was given.
export type Meeting = {
  id: string;
  contact_id: string;
  type: "meeting" | "drop-in" | "call";
  starts_at: string;
  ends_at: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
};

export const METERS_PER_MILE = 1609.344;

/** Great-circle distance in meters. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

export const CATEGORY_COLORS: Record<Category, string> = {
  founder: "#2563eb",
  financier: "#16a34a",
  "supply-chain": "#ea580c",
  other: "#6b7280",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  founder: "Founders",
  financier: "Financiers",
  "supply-chain": "Supply chain",
  other: "Other",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  "must-see": "Must see",
  "want-to-see": "Want to see",
  "if-nearby": "If nearby",
};

export function googleMapsDirections(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
