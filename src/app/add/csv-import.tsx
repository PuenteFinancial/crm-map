"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/contacts";
import { CSV_TARGETS, guessTarget, parseCsv, type CsvTarget } from "@/lib/csv";
import type { ContactInput, IngestResult, OnDuplicate } from "@/lib/ingest";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "@/lib/types";
import { saveContacts } from "./import-actions";

const field = "rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-[16px] md:text-sm dark:border-neutral-700 dark:bg-neutral-900";
const BATCH = 25;

function toCategory(value: string, fallback: Category): Category {
  const v = value.trim().toLowerCase();
  if ((CATEGORIES as readonly string[]).includes(v)) return v as Category;
  if (/found|ceo|owner|brand/.test(v)) return "founder";
  if (/financ|bank|lend|invest|capital|factor/.test(v)) return "financier";
  if (/supply|logist|freight|import|export|3pl|customs|warehouse|sourcing/.test(v)) return "supply-chain";
  return fallback;
}

function toPriority(value: string, fallback: Priority): Priority {
  const v = value.trim().toLowerCase();
  if ((PRIORITIES as readonly string[]).includes(v)) return v as Priority;
  if (/must|high|^a$|^1$/.test(v)) return "must-see";
  if (/nearby|low|^c$|^3$/.test(v)) return "if-nearby";
  if (/want|med|^b$|^2$/.test(v)) return "want-to-see";
  return fallback;
}

export function CsvImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<CsvTarget[]>([]);
  const [defaultCategory, setDefaultCategory] = useState<Category>("other");
  const [defaultPriority, setDefaultPriority] = useState<Priority>("want-to-see");
  const [onDuplicate, setOnDuplicate] = useState<OnDuplicate>("merge");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<IngestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = rows[0] ?? [];
  const body = useMemo(() => rows.slice(1), [rows]);

  async function load(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResults(null);
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("That file has no rows under the header.");
    setFileName(file.name);
    setRows(parsed);
    setMapping(parsed[0].map(guessTarget));
  }

  // Turn each row into a contact using the column mapping. Rows with no name are skipped.
  const contacts = useMemo(() => {
    const out: ContactInput[] = [];
    let skipped = 0;
    for (const r of body) {
      const pick = (t: CsvTarget) => mapping.flatMap((m, i) => (m === t && r[i]?.trim() ? [r[i].trim()] : []));
      const name = pick("name")[0] ?? [...pick("first_name"), ...pick("last_name")].join(" ");
      if (!name) {
        skipped++;
        continue;
      }
      out.push({
        name,
        company: pick("company")[0] ?? null,
        role: pick("role")[0] ?? null,
        email: pick("email")[0] ?? null,
        phone: pick("phone")[0] ?? null,
        linkedin: pick("linkedin")[0] ?? null,
        address: pick("address").join(", ") || null,
        company_website: pick("company_website")[0] ?? null,
        category: toCategory(pick("category")[0] ?? "", defaultCategory),
        priority: toPriority(pick("priority")[0] ?? "", defaultPriority),
        notes: pick("notes").join("\n") || null,
        source: `csv: ${fileName}`,
      });
    }
    return { out, skipped };
  }, [body, mapping, defaultCategory, defaultPriority, fileName]);

  async function runImport() {
    setError(null);
    const all = contacts.out;
    const collected: IngestResult[] = [];
    setProgress({ done: 0, total: all.length });
    try {
      for (let i = 0; i < all.length; i += BATCH) {
        const batch = all.slice(i, i + BATCH).map((contact) => ({ contact, onDuplicate }));
        collected.push(...(await saveContacts(batch)));
        setProgress({ done: Math.min(i + BATCH, all.length), total: all.length });
      }
      setResults(collected);
    } catch (e) {
      setError(`${(e as Error).message}. ${collected.length} rows were imported before this.`);
      setResults(collected);
    } finally {
      setProgress(null);
    }
  }

  if (results) {
    const count = (s: IngestResult["status"]) => results.filter((r) => r.status === s).length;
    const flagged = results.filter((r) => r.status === "created" && r.needsReview).length;
    const problems = results.filter((r) => r.status === "error" || r.status === "duplicate");
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-base font-medium">Import finished</p>
        <ul className="flex flex-col gap-1">
          <li>✅ {count("created")} added{flagged ? ` (${flagged} need a location)` : ""}</li>
          {count("merged") > 0 && <li>🔄 {count("merged")} existing contacts filled in</li>}
          {count("duplicate") > 0 && <li>⏭ {count("duplicate")} skipped as duplicates</li>}
          {count("error") > 0 && <li className="text-red-700">⚠️ {count("error")} failed</li>}
        </ul>
        {error && <p className="text-red-600">{error}</p>}
        {problems.length > 0 && (
          <details>
            <summary className="cursor-pointer text-neutral-600">Show skipped and failed rows</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {problems.map((r, i) => (
                <li key={i} className="text-neutral-600">
                  {r.name}: {r.status === "error" ? r.error : `already saved (same ${r.matchedOn.replace("_", " ")})`}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex gap-3">
          <Link href="/" className="rounded-lg bg-neutral-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-neutral-900">See on map</Link>
          <button onClick={() => { setRows([]); setResults(null); setFileName(null); }} className="text-neutral-500 underline">
            Import another
          </button>
        </div>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-500">
          Upload a CSV with a header row, such as a LinkedIn connections export, a scraped list or a spreadsheet. You&apos;ll match
          columns and preview before anything is saved.
        </p>
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-neutral-400 px-4 py-8 text-center text-sm">
          <span className="font-medium">Choose a CSV file</span>
          <span className="text-neutral-500">Duplicates are matched by email, LinkedIn, then name + company</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => load(e.target.files?.[0])} />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  const preview = contacts.out.slice(0, 5);
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium">{fileName} · {body.length} rows</p>
        <button onClick={() => setRows([])} className="text-neutral-500 underline">Change file</button>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="font-semibold">Match columns</h3>
        {headers.map((h, i) => (
          <label key={i} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={h}>
              {h || `Column ${i + 1}`}
              <span className="text-neutral-400"> · {body.find((r) => r[i]?.trim())?.[i]?.slice(0, 30) ?? "empty"}</span>
            </span>
            <select
              value={mapping[i]}
              onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? (e.target.value as CsvTarget) : v)))}
              className={`${field} w-40 shrink-0`}
            >
              {Object.entries(CSV_TARGETS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Category when not given
          <select value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value as Category)} className={field}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Priority when not given
          <select value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value as Priority)} className={field}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-neutral-500">
          If someone is already saved
          <select value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value as OnDuplicate)} className={field}>
            <option value="merge">Fill in their missing info</option>
            <option value="skip">Skip them</option>
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="font-semibold">
          Preview · {contacts.out.length} contacts{contacts.skipped ? ` (${contacts.skipped} rows without a name skipped)` : ""}
        </h3>
        {preview.length === 0 && <p className="text-red-600">No names found. Map a column to Full name, or First + Last name.</p>}
        {preview.map((c, i) => (
          <div key={i} className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900">
            <p className="font-medium">{c.name}{c.company && <span className="font-normal text-neutral-500"> · {c.company}</span>}</p>
            <p className="text-xs text-neutral-500">
              {[c.role, c.address ?? "no address", CATEGORY_LABELS[c.category as Category], c.email].filter(Boolean).join(" · ")}
            </p>
          </div>
        ))}
      </div>

      {error && <p className="text-red-600">{error}</p>}
      <button
        onClick={runImport}
        disabled={progress != null || contacts.out.length === 0}
        className="rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {progress ? `Importing… ${progress.done} of ${progress.total}` : `Import ${contacts.out.length} contacts`}
      </button>
      <p className="text-xs text-neutral-500">Addresses are looked up as they import, so big files take a minute.</p>
    </div>
  );
}
