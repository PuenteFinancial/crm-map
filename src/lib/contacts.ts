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
  "relationship, notes, address, map_lat, map_lng, geocode_confidence, location_from_company, needs_review";

export type Visit = {
  id: string;
  contact_id: string;
  status: "scheduled" | "done" | "skipped";
  type: "meeting" | "drop-in" | "call";
  starts_at: string | null;
  who: "joshua" | "colton" | "both" | null;
  outcome: string | null;
  notes: string | null;
  next_step: string | null;
};

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
