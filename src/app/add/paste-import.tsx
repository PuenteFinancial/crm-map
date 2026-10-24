"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/contacts";
import type { ImageInput } from "@/lib/extract";
import type { IngestResult, OnDuplicate } from "@/lib/ingest";
import { CATEGORIES, PRIORITIES, type Priority } from "@/lib/types";
import { extractForReview, saveContacts, type ReviewDraft } from "./import-actions";

const field = "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[16px] dark:border-neutral-700 dark:bg-neutral-900";
const MAX_SIDE = 1568; // long edge Claude reads at full detail

// Phone photos are several MB; shrink to a JPEG Claude reads just as well.
async function toImageInput(file: File): Promise<ImageInput> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

type Card = ReviewDraft & {
  key: number;
  priority: Priority;
  onDuplicate: OnDuplicate;
  status: "pending" | "saving" | "discarded" | { result: IngestResult };
};

export function PasteImport() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ name: string; preview: string; input: ImageInput }[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const added = await Promise.all(
        [...files].slice(0, 6 - images.length).map(async (f) => {
          const input = await toImageInput(f);
          return { name: f.name, preview: `data:${input.mediaType};base64,${input.data}`, input };
        }),
      );
      setImages((cur) => [...cur, ...added]);
    } catch {
      setError("Couldn't read that image. Try a JPEG or PNG screenshot.");
    }
  }

  function extract() {
    setError(null);
    setNote(null);
    startReading(async () => {
      const res = await extractForReview(text, images.map((i) => i.input));
      if ("error" in res) return setError(res.error);
      setNote(res.note);
      setCards(
        res.drafts.map((d, i) => ({
          ...d,
          key: i,
          priority: "want-to-see",
          // Same email/LinkedIn means it's them: fill in what's missing. A name match might be someone else.
          onDuplicate: d.preview.duplicate ? (d.preview.duplicate.matchedOn === "name" ? "skip" : "merge") : "skip",
          status: "pending",
        })),
      );
    });
  }

  function update(key: number, patch: Partial<Card>) {
    setCards((cs) => cs!.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  function save(keys: number[]) {
    const targets = cards!.filter((c) => keys.includes(c.key) && c.status === "pending");
    if (!targets.length) return;
    setCards((cs) => cs!.map((c) => (keys.includes(c.key) && c.status === "pending" ? { ...c, status: "saving" } : c)));
    startSaving(async () => {
      try {
        const results = await saveContacts(
          targets.map((c) => ({
            onDuplicate: c.onDuplicate,
            contact: {
              name: c.name, company: c.company, role: c.role, email: c.email, phone: c.phone, linkedin: c.linkedin,
              address: c.address, company_website: c.company_website, category: c.category, priority: c.priority,
              notes: c.notes, source: images.length ? "claude: photo" : "claude: paste",
            },
          })),
        );
        setCards((cs) =>
          cs!.map((c) => {
            const i = targets.findIndex((t) => t.key === c.key);
            return i === -1 ? c : { ...c, status: { result: results[i] } };
          }),
        );
      } catch (e) {
        setError((e as Error).message);
        setCards((cs) => cs!.map((c) => (c.status === "saving" ? { ...c, status: "pending" } : c)));
      }
    });
  }

  function reset() {
    setCards(null);
    setText("");
    setImages([]);
    setNote(null);
  }

  if (cards) {
    const pending = cards.filter((c) => c.status === "pending");
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-medium">{cards.length === 0 ? "No contacts found" : `Found ${cards.length}`}</p>
          <button onClick={reset} className="text-sm text-neutral-500 underline">Start over</button>
        </div>
        {note && <p className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{note}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {pending.length > 1 && (
          <button
            onClick={() => save(pending.map((c) => c.key))}
            disabled={saving}
            className="rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            Save all {pending.length}
          </button>
        )}
        {cards.map((c) => (
          <ReviewCard key={c.key} card={c} onChange={(p) => update(c.key, p)} onSave={() => save([c.key])} saving={saving} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-neutral-500">
        Paste anything: a LinkedIn profile, email signature, scraped list or notes. Or add a photo of a business card or
        screenshot. Claude pulls out the contacts for you to check before anything is saved.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={"Jane Doe, CEO at Acme Imports\njane@acme.com · Vernon, CA\n…"}
        className={field}
      />
      <div className="flex flex-wrap items-center gap-2">
        {images.map((img, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
            <img src={img.preview} alt={img.name} className="size-16 rounded-lg object-cover" />
            <button
              onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-900 px-1.5 text-xs text-white"
              aria-label={`Remove ${img.name}`}
            >
              ✕
            </button>
          </div>
        ))}
        {images.length < 6 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-dashed border-neutral-400 px-3 py-2 text-sm"
          >
            📷 Add photo
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={extract}
        disabled={reading || (!text.trim() && images.length === 0)}
        className="rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
      >
        {reading ? "Reading… (about 10 seconds)" : "Find contacts"}
      </button>
    </div>
  );
}

function ReviewCard({ card: c, onChange, onSave, saving }: { card: Card; onChange: (p: Partial<Card>) => void; onSave: () => void; saving: boolean }) {
  const [open, setOpen] = useState(false);

  if (c.status === "discarded") {
    return (
      <p className="flex justify-between rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500">
        Discarded {c.name}
        <button onClick={() => onChange({ status: "pending" })} className="underline">Undo</button>
      </p>
    );
  }
  if (typeof c.status === "object") {
    const r = c.status.result;
    const ok = r.status === "created" || r.status === "merged";
    return (
      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${ok ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
        <span className="flex-1">
          {r.status === "created" && `Saved ${r.name}${r.needsReview ? " · needs a location" : ""}`}
          {r.status === "merged" && `Updated ${r.name}${r.fields.length ? ` (${r.fields.join(", ")})` : " (nothing new)"}`}
          {r.status === "duplicate" && `Skipped: ${r.name} is already saved`}
          {r.status === "error" && `Couldn't save ${r.name}: ${r.error}`}
        </span>
        {r.status !== "error" && <Link href={`/?c=${r.id}`} className="shrink-0 underline">Open</Link>}
      </div>
    );
  }

  const dup = c.preview.duplicate;
  const loc = c.preview.location;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <input value={c.name} onChange={(e) => onChange({ name: e.target.value })} className={`${field} font-medium`} aria-label="Name" />
      <div className="grid grid-cols-2 gap-2">
        <input value={c.company ?? ""} onChange={(e) => onChange({ company: e.target.value || null })} placeholder="Company" className={field} />
        <input value={c.role ?? ""} onChange={(e) => onChange({ role: e.target.value || null })} placeholder="Role" className={field} />
        <select value={c.category} onChange={(e) => onChange({ category: e.target.value as Card["category"] })} className={field}>
          {CATEGORIES.map((v) => <option key={v} value={v}>{CATEGORY_LABELS[v]}</option>)}
        </select>
        <select value={c.priority} onChange={(e) => onChange({ priority: e.target.value as Priority })} className={field}>
          {PRIORITIES.map((v) => <option key={v} value={v}>{PRIORITY_LABELS[v]}</option>)}
        </select>
      </div>
      <input value={c.address ?? ""} onChange={(e) => onChange({ address: e.target.value || null })} placeholder="Address or city" className={field} />
      <p className={`text-sm ${loc && loc.confidence !== "low" ? "text-neutral-600" : "text-amber-700"}`}>
        {loc
          ? `📍 ${loc.viaCompany ? "At company: " : ""}${loc.placeName}${loc.confidence === "city" ? " (rough)" : loc.confidence === "low" ? " (unsure, will be flagged)" : ""}`
          : "📍 No location yet. It'll be saved and flagged so you can drop a pin."}
      </p>

      {dup && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>
            Already saved as <strong>{dup.name}</strong> (same {dup.matchedOn === "name" ? "name and company" : dup.matchedOn}).
          </p>
          <div className="flex flex-wrap gap-3">
            {(["merge", "skip", ...(dup.matchedOn === "name" ? (["force"] as const) : [])] as OnDuplicate[]).map((o) => (
              <label key={o} className="flex items-center gap-1.5">
                <input type="radio" checked={c.onDuplicate === o} onChange={() => onChange({ onDuplicate: o })} />
                {o === "merge" ? "Fill in missing info" : o === "skip" ? "Skip" : "Different person, add"}
              </label>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => setOpen(!open)} className="self-start text-sm text-blue-600">
        {open ? "Hide details" : `Details${[c.email, c.phone, c.linkedin].filter(Boolean).length ? ` · ${[c.email && "email", c.phone && "phone", c.linkedin && "LinkedIn"].filter(Boolean).join(", ")}` : ""}`}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          <input value={c.email ?? ""} onChange={(e) => onChange({ email: e.target.value || null })} placeholder="Email" className={field} />
          <input value={c.phone ?? ""} onChange={(e) => onChange({ phone: e.target.value || null })} placeholder="Phone" className={field} />
          <input value={c.linkedin ?? ""} onChange={(e) => onChange({ linkedin: e.target.value || null })} placeholder="LinkedIn URL" className={field} />
          <textarea value={c.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value || null })} rows={3} placeholder="Notes" className={field} />
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving || c.status === "saving" || !c.name.trim()}
          className="flex-1 rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {c.status === "saving" ? "Saving…" : dup && c.onDuplicate === "skip" ? "Skip" : dup && c.onDuplicate === "merge" ? "Update existing" : "Save"}
        </button>
        <button onClick={() => onChange({ status: "discarded" })} className="px-3 text-sm text-neutral-500">Discard</button>
      </div>
    </div>
  );
}
