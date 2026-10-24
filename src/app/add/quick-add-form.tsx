"use client";

import { useActionState, useState } from "react";
import { CATEGORIES, OWNERS, PRIORITIES } from "@/lib/types";
import { addContact, type AddState } from "./actions";

const input =
  "w-full rounded-lg border border-neutral-300 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-900";
const label = "flex flex-col gap-1 text-sm font-medium";

export function QuickAddForm() {
  const [state, action, pending] = useActionState(addContact, {} as AddState);
  // Remount the form after each save so it clears.
  const [formKey, setFormKey] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  if (state.result?.status === "created" && state.result.id !== lastSaved) {
    setLastSaved(state.result.id);
    setFormKey((k) => k + 1);
  }

  const v = state.values ?? {};
  const result = state.result;

  return (
    <div className="flex flex-col gap-4">
      {result && <ResultBanner result={result} />}

      <form key={formKey} action={action} className="flex flex-col gap-3">
        <label className={label}>
          Name
          <input name="name" required defaultValue={v.name} className={input} autoComplete="off" />
        </label>
        <label className={label}>
          Company
          <input name="company" defaultValue={v.company} className={input} autoComplete="off" />
        </label>
        <label className={label}>
          Role
          <input name="role" defaultValue={v.role} className={input} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Category
            <select name="category" defaultValue={v.category || "other"} className={input}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className={label}>
            Priority
            <select name="priority" defaultValue={v.priority || "want-to-see"} className={input}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <LocationFields address={v.address} lat={v.lat} lng={v.lng} />

        <details className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <summary className="cursor-pointer text-sm font-medium">Contact info & notes</summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className={label}>
              Email
              <input name="email" type="email" defaultValue={v.email} className={input} />
            </label>
            <label className={label}>
              Phone
              <input name="phone" type="tel" defaultValue={v.phone} className={input} />
            </label>
            <label className={label}>
              LinkedIn
              <input name="linkedin" type="url" defaultValue={v.linkedin} className={input} />
            </label>
            <label className={label}>
              Owner
              <select name="owner" defaultValue={v.owner} className={input}>
                <option value="">—</option>
                {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className={label}>
              Notes
              <textarea name="notes" rows={3} defaultValue={v.notes} className={input} />
            </label>
          </div>
        </details>

        {result?.status === "duplicate" && result.matchedOn === "name" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="force" value="1" /> It&apos;s a different person, add anyway
          </label>
        )}

        <button
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-3 py-3 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Saving…" : "Save contact"}
        </button>
      </form>
    </div>
  );
}

function LocationFields({ address, lat, lng }: { address?: string; lat?: string; lng?: string }) {
  const [pin, setPin] = useState(lat && lng ? { lat, lng } : null);
  const [status, setStatus] = useState<string | null>(null);

  function useMyLocation() {
    if (!navigator.geolocation) return setStatus("This browser can't share location.");
    setStatus("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) });
        setStatus(null);
      },
      (err) => setStatus(err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className={label}>
        Address
        <input
          name="address"
          defaultValue={address}
          placeholder="Street address, or just a city"
          className={input}
          autoComplete="street-address"
        />
      </label>
      <input type="hidden" name="lat" value={pin?.lat ?? ""} />
      <input type="hidden" name="lng" value={pin?.lng ?? ""} />
      <div className="flex items-center gap-3 text-sm">
        {pin ? (
          <>
            <span>📍 Pinned here ({pin.lat}, {pin.lng})</span>
            <button type="button" onClick={() => setPin(null)} className="text-neutral-500 underline">Clear</button>
          </>
        ) : (
          <button type="button" onClick={useMyLocation} className="text-blue-600 underline">
            Use my location instead
          </button>
        )}
        {status && <span className="text-neutral-500">{status}</span>}
      </div>
    </div>
  );
}

function ResultBanner({ result }: { result: NonNullable<AddState["result"]> }) {
  const base = "rounded-lg px-3 py-2 text-sm";
  switch (result.status) {
    case "created":
      return (
        <p className={`${base} bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200`}>
          Saved {result.name}.{" "}
          {result.needsReview
            ? "No usable location yet. It's flagged so you can drop a pin later."
            : result.geocode === "city"
              ? "Placed at the city level."
              : ""}
        </p>
      );
    case "duplicate":
      return (
        <p className={`${base} bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200`}>
          {result.name} is already in the list (same {result.matchedOn.replace("_", " ")}). Nothing was saved.
        </p>
      );
    case "merged":
      return <p className={`${base} bg-green-50 text-green-800`}>Updated {result.name}.</p>;
    case "error":
      return <p className={`${base} bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200`}>{result.error}</p>;
  }
}
