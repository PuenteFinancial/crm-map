"use server";

import { ingestContact, type ContactInput, type IngestResult } from "@/lib/ingest";
import { createClient } from "@/lib/supabase/server";

export type AddState = { result?: IngestResult; values?: Record<string, string> };

const FIELDS = [
  "name", "company", "role", "category", "priority", "email", "phone", "linkedin",
  "address", "lat", "lng", "notes", "owner",
] as const;

export async function addContact(_prev: AddState, form: FormData): Promise<AddState> {
  const values: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")]));
  const { lat, lng, ...text } = values;
  // ingestContact validates everything; here we only turn blank fields into nulls.
  const input = Object.fromEntries(Object.entries(text).map(([k, val]) => [k, val || null])) as ContactInput;

  const supabase = await createClient();
  const result = await ingestContact(
    supabase,
    { ...input, lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null, source: "quick-add" },
    form.get("force") === "1" ? "force" : "skip",
  );

  // Keep the form filled unless it saved, so a duplicate or error can be fixed in place.
  return result.status === "created" ? { result } : { result, values };
}
