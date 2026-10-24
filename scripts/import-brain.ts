// One-time import of search-brain people/ and companies/ into Supabase.
// Re-runnable: records are matched on brain_slug and only empty fields are filled.
//   npm run import:brain [-- /path/to/search-brain]
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { ingestContact, upsertCompany, type ContactInput } from "../src/lib/ingest";
import { COMPANY_KINDS, OWNERS, STAGES, type Category } from "../src/lib/types";
import { db } from "./db";

const brainDir = process.argv[2] ?? join(homedir(), "Work/search-brain");

type Doc = { slug: string; title: string; data: Record<string, unknown>; body: string };

function readDocs(folder: "people" | "companies"): Doc[] {
  const dir = join(brainDir, folder);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data, content } = matter(readFileSync(join(dir, f), "utf8"));
      const title = content.match(/^#\s+(.+)$/m)?.[1].trim() ?? f.replace(/\.md$/, "");
      return { slug: `${folder}/${f.replace(/\.md$/, "")}`, title, data, body: content };
    });
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function oneOf<T extends readonly string[]>(options: T, value: unknown): T[number] | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value : null;
}

function section(body: string, heading: string) {
  const match = body.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  const content = match?.[1].replace(/<!--[\s\S]*?-->/g, "").trim();
  return content && content !== "-" ? content : null;
}

// Wiki links → plain text: [[companies/x|Label]] → Label, [[people/y]] → y
function plain(markdown: string) {
  return markdown.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[(?:[^\]/]+\/)?([^\]]+)\]\]/g, "$1");
}

// "Crew (trycrew.com)" → { name: Crew, website: trycrew.com }
// "Thread (Thread Wallets), Provo" → { name: Thread (Thread Wallets), address: Provo }
// "[[companies/shyft-global|Shyft Global]]" → { brainSlug: companies/shyft-global }
function parseCompanyField(raw: string) {
  const link = raw.match(/\[\[(companies\/[^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (link) return { brainSlug: link[1], name: link[2] ?? null, website: null, address: null };

  let name = raw.trim();
  let address: string | null = null;
  const trailingPlace = name.match(/^(.*\S),\s*([A-Z][A-Za-z .]+)$/);
  if (trailingPlace) [, name, address] = trailingPlace;
  let website: string | null = null;
  const domain = name.match(/\s*\(([a-z0-9-]+(?:\.[a-z0-9-]+)+)\)\s*/i);
  if (domain) {
    website = domain[1];
    name = name.replace(domain[0], " ").trim();
  }
  return { brainSlug: null, name, website, address };
}

function guessCategory(role: string | null, industry: string | null): Category {
  if (role && /founder|\bceo\b/i.test(role)) return "founder";
  if (industry && /financ|capital|lend|bank|invest/i.test(industry)) return "financier";
  if (industry && /supply|import|export|logistic|freight|broker|sourcing/i.test(industry)) return "supply-chain";
  return "other";
}

async function main() {
  const people = readDocs("people");
  const companies = readDocs("companies");
  const companyBySlug = new Map(companies.map((c) => [c.slug, c]));

  const wanted = people.filter((p) => text(p.data.relationship) !== "inspiration");
  const linkedSlugs = new Set(
    wanted.map((p) => text(p.data.company) && parseCompanyField(text(p.data.company)!).brainSlug).filter(Boolean),
  );

  console.log(`Brain: ${people.length} people, ${companies.length} companies at ${brainDir}`);
  console.log(`Skipping inspiration-only people: ${people.filter((p) => !wanted.includes(p)).map((p) => p.title).join(", ") || "none"}`);

  // Companies with a real relationship (kind other than inspiration), or that a contact links to.
  for (const co of companies) {
    const kind = oneOf(COMPANY_KINDS, co.data.kind);
    if (!(kind && kind !== "inspiration") && !linkedSlugs.has(co.slug)) continue;
    const row = await upsertCompany(db, {
      name: co.title,
      website: text(co.data.website),
      industry: text(co.data.industry),
      kind,
      address: text(co.data.location),
      notes: section(co.body, "What they do") && plain(section(co.body, "What they do")!),
      brain_slug: co.slug,
    });
    console.log(`company  ${row.name}${row.lat == null ? "  (no location)" : ""}`);
  }

  for (const p of wanted) {
    const companyField = text(p.data.company);
    const company = companyField ? parseCompanyField(companyField) : null;
    const linked = company?.brainSlug ? companyBySlug.get(company.brainSlug) : null;
    const role = text(p.data.role);

    const notes = [section(p.body, "Who they are"), section(p.body, "Why they matter to us")]
      .filter(Boolean)
      .map((s) => plain(s!))
      .join("\n\n");

    const input: ContactInput = {
      name: p.title,
      company: linked?.title ?? company?.name ?? null,
      company_website: company?.website ?? null,
      company_address: company?.address ?? null,
      role,
      email: text(p.data.email),
      phone: text(p.data.phone),
      linkedin: text(p.data.linkedin),
      category: guessCategory(role, text(linked?.data.industry)),
      relationship: text(p.data.relationship),
      stage: oneOf(STAGES, p.data.stage),
      owner: oneOf(OWNERS, p.data.owner),
      source: ["search-brain", text(p.data.source)].filter(Boolean).join(": "),
      notes: notes || null,
      brain_slug: p.slug,
    };

    const result = await ingestContact(db, input, "merge");
    const detail =
      result.status === "created" ? (result.needsReview ? "needs a location" : `located (${result.geocode})`)
      : result.status === "merged" ? (result.fields.length ? `filled ${result.fields.join(", ")}` : "already up to date")
      : result.status === "error" ? result.error
      : `matched on ${result.matchedOn}`;
    console.log(`contact  ${result.status.padEnd(9)} ${result.name}  ${detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
