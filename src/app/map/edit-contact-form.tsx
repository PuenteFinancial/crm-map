"use client";

import { useState, useTransition } from "react";
import type { MapContact } from "@/lib/contacts";
import { OWNERS } from "@/lib/types";
import { deleteContact, updateContactDetails } from "./actions";

const field = "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[16px]";
const label = "flex flex-col gap-1 text-xs font-medium text-neutral-500";

type Props = {
  contact: MapContact;
  onDone: () => void;
  onDeleted: () => void;
};

export function EditContactForm({ contact: c, onDone, onDeleted }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    const text = (k: string) => String(form.get(k) ?? "").trim() || null;
    startTransition(async () => {
      try {
        const res = await updateContactDetails(c.id, {
          name: String(form.get("name") ?? ""),
          company: text("company"),
          role: text("role"),
          email: text("email"),
          phone: text("phone"),
          linkedin: text("linkedin"),
          relationship: text("relationship"),
          owner: text("owner") as (typeof OWNERS)[number] | null,
          notes: text("notes"),
        });
        if (res.error) setError(res.error);
        else onDone();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function remove() {
    if (!window.confirm(`Delete ${c.name}? Their visit history goes too. This can't be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteContact(c.id);
        onDeleted();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Edit contact</h3>
        <button type="button" onClick={onDone} className="text-sm text-neutral-500">Cancel</button>
      </div>
      <label className={label}>
        Name
        <input name="name" defaultValue={c.name} required className={field} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          Company
          <input name="company" defaultValue={c.company_name ?? ""} className={field} />
        </label>
        <label className={label}>
          Role
          <input name="role" defaultValue={c.role ?? ""} className={field} />
        </label>
      </div>
      <label className={label}>
        Email
        <input name="email" type="email" defaultValue={c.email ?? ""} className={field} />
      </label>
      <label className={label}>
        Phone
        <input name="phone" type="tel" defaultValue={c.phone ?? ""} className={field} />
      </label>
      <label className={label}>
        LinkedIn
        <input name="linkedin" type="url" defaultValue={c.linkedin ?? ""} className={field} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          Owner
          <select name="owner" defaultValue={c.owner ?? ""} className={field}>
            <option value="">—</option>
            {OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className={label}>
          Relationship
          <input name="relationship" defaultValue={c.relationship ?? ""} placeholder="expert, investor…" className={field} />
        </label>
      </div>
      <label className={label}>
        Notes
        <textarea name="notes" rows={4} defaultValue={c.notes ?? ""} className={field} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={pending} className="rounded-xl bg-neutral-900 py-3 font-medium text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save changes"}
      </button>
      <button type="button" onClick={remove} disabled={pending} className="py-1 text-sm text-red-600 disabled:opacity-50">
        Delete contact
      </button>
    </form>
  );
}
