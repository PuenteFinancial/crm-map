"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { geocode } from "@/lib/geocode";
import { routePath, routeSegment } from "@/lib/mapbox-routing";
import { planDay, type PlanMeeting, type PlanResult, type PlanSettings } from "@/lib/route";
import { createClient } from "@/lib/supabase/server";
import { wallTimeToIso } from "@/lib/time";
import type { Priority } from "@/lib/types";

export type Place = { id: string; name: string; address: string | null; lat: number; lng: number; is_default: boolean };

export type DayPlan = {
  date: string;
  picks: string[];
  settings: PlanSettings | null;
  result: PlanResult | null;
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const settingsSchema = z.object({
  start: z.object({ name: z.string(), lat: z.number(), lng: z.number(), here: z.boolean().optional() }),
  dayStart: hhmm,
  dayEnd: hhmm,
  dwellMin: z.number().int().min(0).max(240),
  returnToStart: z.boolean(),
});

export async function getPlanData(day: string): Promise<{ plan: DayPlan; places: Place[] }> {
  date.parse(day);
  const supabase = await createClient();
  const [planRes, placesRes] = await Promise.all([
    supabase.from("day_plans").select("stops, settings, result").eq("plan_date", day).maybeSingle(),
    supabase.from("places").select("id, name, address, lat, lng, is_default").order("created_at"),
  ]);
  if (planRes.error) throw new Error(planRes.error.message);
  if (placesRes.error) throw new Error(placesRes.error.message);
  const row = planRes.data;
  return {
    plan: {
      date: day,
      picks: (row?.stops as string[] | undefined) ?? [],
      settings: row?.settings && Object.keys(row.settings).length ? (row.settings as PlanSettings) : null,
      result: (row?.result as PlanResult | null) ?? null,
    },
    places: placesRes.data as Place[],
  };
}

/** Save picks/settings without routing. Any earlier route is cleared since it no longer matches. */
export async function savePlan(day: string, picks: string[], settings: PlanSettings | null) {
  date.parse(day);
  const supabase = await createClient();
  const { error } = await supabase.from("day_plans").upsert(
    { plan_date: day, stops: z.array(z.uuid()).parse(picks), settings: settings ? settingsSchema.parse(settings) : {}, result: null },
    { onConflict: "plan_date" },
  );
  if (error) throw new Error(error.message);
}

export async function optimizePlan(day: string, picks: string[], rawSettings: PlanSettings): Promise<PlanResult> {
  date.parse(day);
  const settings = settingsSchema.parse(rawSettings);
  const ids = z.array(z.uuid()).parse(picks);
  const supabase = await createClient();

  const dayStartIso = wallTimeToIso(`${day}T${settings.dayStart}`);
  const dayEndIso = wallTimeToIso(`${day}T${settings.dayEnd}`);
  const [meetingsRes, contactsRes] = await Promise.all([
    supabase
      .from("visits")
      .select("id, contact_id, type, starts_at, ends_at, lat, lng")
      .eq("status", "scheduled")
      .gte("starts_at", wallTimeToIso(`${day}T00:00`))
      .lt("starts_at", wallTimeToIso(`${day}T23:59`)),
    supabase.from("contacts_located").select("id, name, priority, map_lat, map_lng"),
  ]);
  if (meetingsRes.error) throw new Error(meetingsRes.error.message);
  if (contactsRes.error) throw new Error(contactsRes.error.message);

  const byId = new Map(contactsRes.data.map((c) => [c.id as string, c]));
  const warnings: string[] = [];
  const meetings: PlanMeeting[] = [];
  for (const v of meetingsRes.data) {
    const c = byId.get(v.contact_id);
    const name = (c?.name as string) ?? "Meeting";
    if (v.type === "call") continue; // calls don't move you
    const lat = v.lat ?? c?.map_lat;
    const lng = v.lng ?? c?.map_lng;
    if (lat == null || lng == null) {
      warnings.push(`Meeting with ${name} has no location, so it's left out of the route.`);
      continue;
    }
    meetings.push({
      id: v.id, contactId: v.contact_id, name, lat, lng, startsAt: v.starts_at,
      endsAt: v.ends_at ?? new Date(Date.parse(v.starts_at) + 45 * 60000).toISOString(),
    });
  }

  const contacts = ids.flatMap((id) => {
    const c = byId.get(id);
    if (!c || c.map_lat == null || c.map_lng == null) {
      if (c) warnings.push(`${c.name} has no location yet, so it's left out.`);
      return [];
    }
    return [{ id, name: c.name as string, priority: c.priority as Priority, lat: c.map_lat as number, lng: c.map_lng as number }];
  });

  const result = await planDay({ dayStartIso, dayEndIso, settings, meetings, contacts }, routeSegment, routePath);
  result.warnings.unshift(...warnings);

  const { error } = await supabase
    .from("day_plans")
    .upsert({ plan_date: day, stops: ids, settings, result }, { onConflict: "plan_date" });
  if (error) throw new Error(error.message);
  return result;
}

export async function addPlace(name: string, address: string, makeDefault: boolean): Promise<{ place?: Place; error?: string }> {
  const hit = await geocode(address);
  if (!hit) return { error: "Couldn't find that address." };
  const supabase = await createClient();
  if (makeDefault) {
    const { error } = await supabase.from("places").update({ is_default: false }).eq("is_default", true);
    if (error) throw new Error(error.message);
  }
  const { data, error } = await supabase
    .from("places")
    .insert({ name: name.trim() || "Hotel", address, lat: hit.lat, lng: hit.lng, is_default: makeDefault })
    .select("id, name, address, lat, lng, is_default")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { place: data as Place };
}
