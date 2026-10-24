"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { extractContacts, type ContactDraft, type ImageInput } from "@/lib/extract";
import { ingestContact, previewContact, type ContactInput, type ContactPreview, type IngestResult, type OnDuplicate } from "@/lib/ingest";
import { createClient } from "@/lib/supabase/server";

export type ReviewDraft = ContactDraft & { preview: ContactPreview };

const imageSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  data: z.string().max(3_000_000),
});

export async function extractForReview(
  text: string,
  images: ImageInput[],
): Promise<{ drafts: ReviewDraft[]; note: string | null } | { error: string }> {
  const imgs = z.array(imageSchema).max(6).parse(images);
  if (!text.trim() && imgs.length === 0) return { error: "Paste some text or add a photo first." };

  try {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    if (!claims) return { error: "Signed out. Reload and sign in again." };

    const result = await extractContacts(text, imgs);
    const drafts = await Promise.all(
      result.contacts.map(async (d) => ({ ...d, preview: await previewContact(supabase, d) })),
    );
    return { drafts, note: result.note_for_user };
  } catch (e) {
    console.error("extractForReview failed", e);
    return { error: e instanceof Error ? e.message : "Something went wrong reading that." };
  }
}

export async function saveContacts(
  items: { contact: ContactInput; onDuplicate: OnDuplicate }[],
): Promise<IngestResult[]> {
  if (items.length > 100) throw new Error("Send at most 100 contacts at a time.");
  const supabase = await createClient();
  const results: IngestResult[] = [];
  // One at a time so duplicates inside the same batch are caught too.
  for (const item of items) results.push(await ingestContact(supabase, item.contact, item.onDuplicate));
  revalidatePath("/");
  return results;
}
