"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Visit } from "@/lib/contacts";
import { geocode, isDrivable } from "@/lib/geocode";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, OWNERS, PRIORITIES, STAGES } from "@/lib/types";

// All of these run as the signed-in user, so RLS limits them to the team.

const contactPatch = z
  .object({
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES),
    stage: z.enum(STAGES).nullable(),
    owner: z.enum(OWNERS).nullable(),
    role: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .partial();

export async function updateContact(id: string, patch: z.input<typeof contactPatch>) {
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").update(contactPatch.parse(patch)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function setPin(id: string, lat: number, lng: number) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ lat, lng, geocode_confidence: "manual", needs_review: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function setAddress(id: string, address: string): Promise<{ ok: boolean; message: string }> {
  const hit = await geocode(address);
  if (!hit) return { ok: false, message: "Couldn't find that address. Try adding the city, or drop a pin." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({
      address,
      lat: hit.lat,
      lng: hit.lng,
      geocode_confidence: hit.confidence,
      needs_review: hit.confidence === "low",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return {
    ok: true,
    message: isDrivable(hit.confidence) ? `Placed at ${hit.placeName}` : `Placed roughly at ${hit.placeName}. Move the pin if it's off.`,
  };
}

export async function getVisits(contactId: string): Promise<Visit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("id, contact_id, status, type, starts_at, ends_at, who, address, outcome, notes, next_step")
    .eq("contact_id", contactId)
    .order("starts_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data as Visit[];
}

const visitInput = z.object({
  // Client-made id for new visits, so a retry after a dropped connection can't log it twice.
  id: z.uuid().nullish(),
  // Set when completing a scheduled meeting instead of logging a new visit.
  visit_id: z.uuid().nullish(),
  contact_id: z.uuid(),
  type: z.enum(["meeting", "drop-in", "call"]),
  who: z.enum(["joshua", "colton", "both"]),
  starts_at: z.iso.datetime({ offset: true }),
  outcome: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  next_step: z.string().trim().nullable(),
  stage: z.enum(STAGES).nullable(),
});

export type LogVisitInput = z.input<typeof visitInput>;

export async function logVisit(raw: LogVisitInput) {
  const { stage, visit_id, id, ...visit } = visitInput.parse(raw);
  const row = {
    ...visit,
    status: "done" as const,
    outcome: visit.outcome || null,
    notes: visit.notes || null,
    next_step: visit.next_step || null,
  };
  const supabase = await createClient();
  const { error } = visit_id
    ? await supabase.from("visits").update(row).eq("id", visit_id)
    : await supabase.from("visits").upsert({ ...row, ...(id ? { id } : {}) }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  if (stage) {
    const { error: stageError } = await supabase.from("contacts").update({ stage }).eq("id", visit.contact_id);
    if (stageError) throw new Error(stageError.message);
  }
  revalidatePath("/");
}

const meetingInput = z.object({
  contact_id: z.uuid(),
  type: z.enum(["meeting", "call"]),
  starts_at: z.iso.datetime({ offset: true }),
  duration_min: z.number().int().min(5).max(600),
  who: z.enum(["joshua", "colton", "both"]).nullable(),
  // Blank means "at the contact's location".
  address: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
});

export async function scheduleMeeting(raw: z.input<typeof meetingInput>): Promise<{ ok: boolean; message?: string }> {
  const m = meetingInput.parse(raw);
  let place: { address: string | null; lat: number | null; lng: number | null } = { address: null, lat: null, lng: null };
  if (m.address && m.type === "meeting") {
    const hit = await geocode(m.address);
    if (!hit) return { ok: false, message: "Couldn't find that address. Try adding the city." };
    place = { address: m.address, lat: hit.lat, lng: hit.lng };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("visits").insert({
    contact_id: m.contact_id,
    status: "scheduled",
    type: m.type,
    who: m.who,
    starts_at: m.starts_at,
    ends_at: new Date(Date.parse(m.starts_at) + m.duration_min * 60000).toISOString(),
    notes: m.notes || null,
    ...place,
  });
  if (error) throw new Error(error.message);

  // Booking a meeting moves early-stage contacts forward.
  await supabase
    .from("contacts")
    .update({ stage: "call-booked" })
    .eq("id", m.contact_id)
    .or("stage.is.null,stage.in.(identified,contacted,replied)");

  revalidatePath("/");
  return { ok: true };
}

export async function skipVisit(visitId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("visits").update({ status: "skipped" }).eq("id", visitId);
  if (error) throw new Error(error.message);
  revalidatePath("/");
}
