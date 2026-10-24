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
    .select("id, contact_id, status, type, starts_at, who, outcome, notes, next_step")
    .eq("contact_id", contactId)
    .order("starts_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data as Visit[];
}

const visitInput = z.object({
  contact_id: z.uuid(),
  type: z.enum(["meeting", "drop-in", "call"]),
  who: z.enum(["joshua", "colton", "both"]),
  starts_at: z.iso.datetime({ offset: true }),
  outcome: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  next_step: z.string().trim().nullable(),
  stage: z.enum(STAGES).nullable(),
});

export async function logVisit(raw: z.input<typeof visitInput>) {
  const { stage, ...visit } = visitInput.parse(raw);
  const supabase = await createClient();
  const { error } = await supabase.from("visits").insert({
    ...visit,
    status: "done",
    outcome: visit.outcome || null,
    notes: visit.notes || null,
    next_step: visit.next_step || null,
  });
  if (error) throw new Error(error.message);
  if (stage) {
    const { error: stageError } = await supabase.from("contacts").update({ stage }).eq("id", visit.contact_id);
    if (stageError) throw new Error(stageError.message);
  }
  revalidatePath("/");
}
