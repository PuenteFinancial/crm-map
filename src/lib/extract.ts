import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CATEGORIES } from "./types";

// Turns whatever gets pasted or photographed (LinkedIn profiles, email signatures,
// scraped lists, business cards) into contact drafts for a human to review.

const draftSchema = z.object({
  name: z.string().describe("Person's full name. If the entry is only a business, the business name."),
  company: z.string().nullable(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  linkedin: z.string().nullable().describe("Full LinkedIn profile URL if present in the input."),
  address: z.string().nullable().describe("Street address, or just city/neighborhood if that's all that's known."),
  company_website: z.string().nullable(),
  category: z.enum(CATEGORIES),
  notes: z.string().nullable().describe("One or two sentences of useful context from the input."),
});

const extractionSchema = z.object({
  contacts: z.array(draftSchema),
  note_for_user: z
    .string()
    .nullable()
    .describe("Short note about anything skipped or ambiguous, or null."),
});

export type ContactDraft = z.infer<typeof draftSchema>;
export type ImageInput = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };

const SYSTEM = `You extract business contacts for Puente, a startup meeting people in person during a trip to Los Angeles: brand founders, trade-finance people (lenders, factoring, banks, investors), and supply-chain operators (importers, freight forwarders, customs brokers, 3PLs, sourcing agents, consultants).

From the user's input (pasted text, a scraped list, an email signature, a LinkedIn profile, a business card or screenshot), list every distinct person or business it describes.

Rules:
- Copy facts only from the input. Never invent or guess emails, phone numbers, URLs or addresses. Leave a field null when the input doesn't give it.
- address: the most specific location given (street address beats city). A company's office address counts as the person's address when it's the only location.
- category: "founder" for founders/owners/CEOs of brands; "financier" for anyone in lending, trade finance, factoring, banking or investing; "supply-chain" for logistics, freight, customs, warehousing, sourcing, manufacturing or supply-chain consulting; otherwise "other".
- notes: what they do and anything that would help in a first meeting, in plain words. No marketing language.
- One entry per person. If the same person appears twice, merge them.
- If the input contains no contacts, return an empty list and say why in note_for_user.`;

export async function extractContacts(text: string, images: ImageInput[]) {
  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.map((img) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
    })),
    { type: "text", text: text.trim() || "Extract the contacts from the image(s)." },
  ];

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // On a safety decline the API retries on a fallback model instead of failing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content }],
    // Plain extraction: low effort keeps it quick on a phone.
    output_config: { effort: "low", format: betaZodOutputFormat(extractionSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to process this input.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("That's too much at once. Try splitting it into smaller pastes.");
  }
  if (!response.parsed_output) throw new Error("Couldn't read contacts from that input.");
  return response.parsed_output;
}
