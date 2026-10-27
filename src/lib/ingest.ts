import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listName } from "./contacts";
import { geocode, type GeocodeResult } from "./geocode";
import { CATEGORIES, COMPANY_KINDS, OWNERS, PRIORITIES, STAGES, type GeocodeConfidence } from "./types";

// The one path every source uses (quick-add, CSV, Claude paste, /api/ingest, brain import):
// normalize -> dedupe -> geocode -> insert, flagging anything a human should look at.

const optionalText = z
  .string()
  .nullish()
  .transform((v) => {
    const t = v?.trim();
    return t ? t : null;
  });

export const companyInputSchema = z.object({
  name: z.string().trim().min(1),
  website: optionalText,
  industry: optionalText,
  kind: z.enum(COMPANY_KINDS).nullish(),
  address: optionalText,
  notes: optionalText,
  brain_slug: optionalText,
});

export const contactInputSchema = z.object({
  name: z.string().trim().min(1),
  company: optionalText,
  company_website: optionalText,
  company_address: optionalText,
  role: optionalText,
  email: optionalText,
  phone: optionalText,
  linkedin: optionalText,
  category: z.enum(CATEGORIES).nullish(),
  relationship: optionalText,
  stage: z.enum(STAGES).nullish(),
  priority: z.enum(PRIORITIES).nullish(),
  owner: z.enum(OWNERS).nullish(),
  source: optionalText,
  notes: optionalText,
  address: optionalText,
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  brain_slug: optionalText,
  /** List to file the contact under (see the List filter). Defaults to one named after `source`. */
  list: optionalText,
});

export type CompanyInput = z.input<typeof companyInputSchema>;
export type ContactInput = z.input<typeof contactInputSchema>;

/** skip: report duplicates and stop. merge: fill the existing record's empty fields. force: insert despite a name match. */
export type OnDuplicate = "skip" | "merge" | "force";

type MatchedOn = "brain_slug" | "email" | "linkedin" | "name" | "company";

export type IngestResult =
  | { status: "created"; id: string; name: string; needsReview: boolean; geocode: GeocodeConfidence | null }
  | { status: "merged"; id: string; name: string; fields: string[] }
  | { status: "duplicate"; id: string; name: string; matchedOn: MatchedOn }
  | { status: "error"; name: string; error: string };

type Located = { lat: number | null; lng: number | null; geocode_confidence: GeocodeConfidence | null };

export function normalizeEmail(email: string | null) {
  return email ? email.toLowerCase() : null;
}

// "linkedin.com/in/Jane-Doe/?utm=x" -> "https://www.linkedin.com/in/jane-doe"
export function normalizeLinkedin(url: string | null) {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/(in|company)\/([^/?#]+)/i);
  return match ? `https://www.linkedin.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}` : url;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeWebsite(url: string | null) {
  if (!url) return null;
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
}

async function locate(address: string | null, lat?: number | null, lng?: number | null): Promise<Located> {
  if (lat != null && lng != null) return { lat, lng, geocode_confidence: "manual" };
  if (!address) return { lat: null, lng: null, geocode_confidence: null };
  let hit: GeocodeResult | null = null;
  try {
    hit = await geocode(address);
  } catch (err) {
    console.error("geocode failed", address, err);
  }
  return hit
    ? { lat: hit.lat, lng: hit.lng, geocode_confidence: hit.confidence }
    : { lat: null, lng: null, geocode_confidence: null };
}

function needsReview(loc: Located) {
  return loc.lat == null || loc.geocode_confidence === "low";
}

/** Find a company by brain slug, website or exact name; create it if missing. */
export async function upsertCompany(db: SupabaseClient, raw: CompanyInput) {
  const input = companyInputSchema.parse(raw);
  const website = normalizeWebsite(input.website);

  const lookups = [
    input.brain_slug ? () => db.from("companies").select("*").eq("brain_slug", input.brain_slug!).limit(1) : null,
    website ? () => db.from("companies").select("*").eq("website", website).limit(1) : null,
    () => db.from("companies").select("*").ilike("name", escapeLike(input.name)).limit(1),
  ];

  for (const lookup of lookups) {
    if (!lookup) continue;
    const { data, error } = await lookup();
    if (error) throw error;
    if (data?.[0]) {
      const existing = data[0];
      // Fill gaps only; never overwrite what a human entered.
      const patch: Record<string, unknown> = {};
      for (const key of ["website", "industry", "kind", "notes", "brain_slug"] as const) {
        const value = key === "website" ? website : input[key];
        if (value && !existing[key]) patch[key] = value;
      }
      if (input.address && !existing.address) {
        Object.assign(patch, { address: input.address }, existing.lat == null ? await locate(input.address) : {});
      }
      if (Object.keys(patch).length) {
        const { data: updated, error: updateError } = await db
          .from("companies").update(patch).eq("id", existing.id).select().single();
        if (updateError) throw updateError;
        return updated;
      }
      return existing;
    }
  }

  const loc = await locate(input.address);
  const { data, error } = await db
    .from("companies")
    .insert({ ...input, website, ...loc })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findDuplicate(db: SupabaseClient, c: z.output<typeof contactInputSchema>, companyId: string | null) {
  // email and linkedin are stored normalized, so exact matches are enough.
  const checks: Array<["brain_slug" | "email" | "linkedin", string | null]> = [
    ["brain_slug", c.brain_slug],
    ["email", c.email],
    ["linkedin", c.linkedin],
  ];
  for (const [field, value] of checks) {
    if (!value) continue;
    const { data, error } = await db.from("contacts").select("*").eq(field, value).limit(1);
    if (error) throw error;
    if (data?.[0]) return { row: data[0], matchedOn: field };
  }
  let byName = db.from("contacts").select("*").ilike("name", escapeLike(c.name));
  byName = companyId ? byName.eq("company_id", companyId) : byName.is("company_id", null);
  const { data, error } = await byName.limit(1);
  if (error) throw error;
  if (data?.[0]) return { row: data[0], matchedOn: "name" as const };

  // A brand-only entry (named after its company) is the same lead as anyone already saved at
  // that company, e.g. "SAME Los Angeles" vs its founder from an earlier list.
  if (companyId && c.company && c.name.trim().toLowerCase() === c.company.trim().toLowerCase()) {
    const { data: atCompany, error: companyError } = await db.from("contacts").select("*").eq("company_id", companyId).limit(1);
    if (companyError) throw companyError;
    if (atCompany?.[0]) return { row: atCompany[0], matchedOn: "company" as const };
  }
  return null;
}

export type ContactPreview = {
  duplicate: { id: string; name: string; matchedOn: MatchedOn } | null;
  /** Where the contact would land on the map, without saving anything. */
  location: { placeName: string; confidence: GeocodeConfidence; viaCompany: boolean } | null;
};

/** Dry run of ingestContact: the duplicate it would hit and where it would be placed. Writes nothing. */
export async function previewContact(db: SupabaseClient, raw: ContactInput): Promise<ContactPreview> {
  const parsed = contactInputSchema.safeParse(raw);
  if (!parsed.success) return { duplicate: null, location: null };
  const c = { ...parsed.data, email: normalizeEmail(parsed.data.email), linkedin: normalizeLinkedin(parsed.data.linkedin) };

  let company: { id: string; lat: number | null; address: string | null } | null = null;
  if (c.company) {
    const { data, error } = await db
      .from("companies").select("id, lat, address").ilike("name", escapeLike(c.company)).limit(1);
    if (error) throw error;
    company = data?.[0] ?? null;
  }

  const dup = await findDuplicate(db, c, company?.id ?? null);

  let location: ContactPreview["location"] = null;
  const own = c.address ? await geocode(c.address).catch(() => null) : null;
  if (own) {
    location = { placeName: own.placeName, confidence: own.confidence, viaCompany: false };
  } else if (c.company_address) {
    const hit = await geocode(c.company_address).catch(() => null);
    if (hit) location = { placeName: hit.placeName, confidence: hit.confidence, viaCompany: true };
  } else if (company?.lat != null) {
    location = { placeName: company.address ?? c.company ?? "company location", confidence: "city", viaCompany: true };
  }

  return {
    duplicate: dup ? { id: dup.row.id, name: dup.row.name, matchedOn: dup.matchedOn } : null,
    location,
  };
}

const MERGEABLE = [
  "role", "email", "phone", "linkedin", "relationship", "stage", "owner", "source", "notes", "brain_slug",
] as const;

export async function ingestContact(
  db: SupabaseClient,
  raw: ContactInput,
  onDuplicate: OnDuplicate = "skip",
): Promise<IngestResult> {
  const parsed = contactInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", name: String(raw?.name ?? "?"), error: z.prettifyError(parsed.error) };
  }
  const c = {
    ...parsed.data,
    email: normalizeEmail(parsed.data.email),
    linkedin: normalizeLinkedin(parsed.data.linkedin),
  };
  const list = c.list ?? listName(c.source);

  try {
    const company = c.company
      ? await upsertCompany(db, { name: c.company, website: c.company_website, address: c.company_address })
      : null;

    const dup = await findDuplicate(db, c, company?.id ?? null);
    if (dup && !(onDuplicate === "force" && dup.matchedOn === "name")) {
      if (onDuplicate !== "merge") {
        return { status: "duplicate", id: dup.row.id, name: dup.row.name, matchedOn: dup.matchedOn };
      }
      const patch: Record<string, unknown> = {};
      for (const key of MERGEABLE) if (c[key] && !dup.row[key]) patch[key] = c[key];
      if (company && !dup.row.company_id) patch.company_id = company.id;
      // Already saved from another list: it's on this one too now.
      if (!(dup.row.lists ?? []).includes(list)) patch.lists = [...(dup.row.lists ?? []), list];
      if ((c.address || c.lat != null) && dup.row.lat == null) {
        const loc = await locate(c.address, c.lat, c.lng);
        Object.assign(patch, { address: c.address ?? dup.row.address }, loc, {
          needs_review: needsReview(loc.lat != null ? loc : (company ?? loc)),
        });
      }
      if (Object.keys(patch).length) {
        const { error } = await db.from("contacts").update(patch).eq("id", dup.row.id);
        if (error) throw error;
      }
      return { status: "merged", id: dup.row.id, name: dup.row.name, fields: Object.keys(patch) };
    }

    const loc = await locate(c.address, c.lat, c.lng);
    // A contact without its own pin shows at its company's location.
    const effective = loc.lat != null ? loc : company ?? loc;

    const { data, error } = await db
      .from("contacts")
      .insert({
        name: c.name,
        company_id: company?.id ?? null,
        role: c.role,
        email: c.email,
        phone: c.phone,
        linkedin: c.linkedin,
        category: c.category ?? "other",
        relationship: c.relationship,
        stage: c.stage ?? null,
        priority: c.priority ?? "want-to-see",
        owner: c.owner ?? null,
        source: c.source,
        notes: c.notes,
        address: c.address,
        brain_slug: c.brain_slug,
        lists: [list],
        ...loc,
        needs_review: needsReview(effective),
      })
      .select("id, name, needs_review")
      .single();
    if (error) throw error;

    return {
      status: "created",
      id: data.id,
      name: data.name,
      needsReview: data.needs_review,
      geocode: effective.geocode_confidence,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
    return { status: "error", name: c.name, error: message };
  }
}

/** Geocode contacts and companies that have an address but no pin (e.g. added before the Mapbox token existed). */
export async function backfillGeocodes(db: SupabaseClient) {
  const summary = { companies: 0, contacts: 0, unresolved: [] as string[] };

  const { data: companies, error: cErr } = await db
    .from("companies").select("id, name, address").is("lat", null).not("address", "is", null);
  if (cErr) throw cErr;
  for (const co of companies ?? []) {
    const loc = await locate(co.address);
    if (loc.lat == null) { summary.unresolved.push(`company: ${co.name}`); continue; }
    const { error } = await db.from("companies").update(loc).eq("id", co.id);
    if (error) throw error;
    summary.companies++;
  }

  const { data: contacts, error: pErr } = await db
    .from("contacts").select("id, name, address").is("lat", null).not("address", "is", null);
  if (pErr) throw pErr;
  for (const p of contacts ?? []) {
    const loc = await locate(p.address);
    if (loc.lat == null) { summary.unresolved.push(`contact: ${p.name}`); continue; }
    const { error } = await db.from("contacts").update({ ...loc, needs_review: needsReview(loc) }).eq("id", p.id);
    if (error) throw error;
    summary.contacts++;
  }

  // Contacts with no pin of their own whose company now has a usable one.
  const { data: flagged, error: fErr } = await db
    .from("contacts")
    .select("id, company:companies(lat, geocode_confidence)")
    .eq("needs_review", true)
    .is("lat", null);
  if (fErr) throw fErr;
  for (const row of flagged ?? []) {
    const company = row.company as unknown as Located | null;
    if (!company || needsReview(company)) continue;
    const { error } = await db.from("contacts").update({ needs_review: false }).eq("id", row.id);
    if (error) throw error;
  }

  return summary;
}
