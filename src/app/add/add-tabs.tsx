"use client";

import { useState } from "react";
import { CsvImport } from "./csv-import";
import { PasteImport } from "./paste-import";
import { QuickAddForm } from "./quick-add-form";

const TABS = [
  { key: "paste", label: "Paste or photo" },
  { key: "csv", label: "CSV" },
  { key: "one", label: "One contact" },
] as const;

export function AddTabs() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("paste");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium ${
              tab === t.key ? "bg-white shadow-sm dark:bg-neutral-950" : "text-neutral-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Keep each tab mounted so switching doesn't lose a half-reviewed import. */}
      <div hidden={tab !== "paste"}><PasteImport /></div>
      <div hidden={tab !== "csv"}><CsvImport /></div>
      <div hidden={tab !== "one"}><QuickAddForm /></div>
    </div>
  );
}
