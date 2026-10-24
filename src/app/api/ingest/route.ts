import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { contactInputSchema, ingestContact } from "@/lib/ingest";
import { createAdminClient } from "@/lib/supabase/server";

// For agents and scripts: POST { contacts: [...], on_duplicate?: "skip" | "merge" | "force" }
// with `Authorization: Bearer $INGEST_API_TOKEN`. Same pipeline as the app's own forms.

const bodySchema = z.object({
  contacts: z.array(contactInputSchema).min(1).max(200),
  on_duplicate: z.enum(["skip", "merge", "force"]).default("skip"),
});

function authorized(request: NextRequest) {
  const expected = process.env.INGEST_API_TOKEN;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  const db = createAdminClient();
  const results = [];
  // Sequential so duplicates within one batch are caught against each other.
  for (const contact of parsed.data.contacts) {
    results.push(await ingestContact(db, contact, parsed.data.on_duplicate));
  }
  return NextResponse.json({ results });
}
