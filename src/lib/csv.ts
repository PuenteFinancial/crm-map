// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas/newlines inside quotes, BOM.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Where a CSV column's values go. Several columns can feed one target (e.g. street + city + zip → address).
export const CSV_TARGETS = {
  ignore: "— Ignore —",
  name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  company: "Company",
  role: "Role / title",
  email: "Email",
  phone: "Phone",
  linkedin: "LinkedIn URL",
  address: "Address (or part of it)",
  company_website: "Website",
  category: "Category",
  priority: "Priority",
  notes: "Notes",
} as const;

export type CsvTarget = keyof typeof CSV_TARGETS;

const GUESSES: [RegExp, CsvTarget][] = [
  [/^(full\s*)?name$|^contact(\s*name)?$/i, "name"],
  [/^first(\s*name)?$|^given/i, "first_name"],
  [/^last(\s*name)?$|^surname|^family/i, "last_name"],
  [/company|organi[sz]ation|business|employer|account/i, "company"],
  [/title|role|position|job/i, "role"],
  [/e-?mail/i, "email"],
  [/phone|mobile|cell|tel/i, "phone"],
  [/linkedin|profile\s*url/i, "linkedin"],
  [/address|street|city|state|zip|postal|location|^region$/i, "address"],
  [/website|^url$|domain|^site$/i, "company_website"],
  [/category|type|segment/i, "category"],
  [/priority|tier/i, "priority"],
  [/note|description|about|summary|comment|bio/i, "notes"],
];

export function guessTarget(header: string): CsvTarget {
  const h = header.trim();
  return GUESSES.find(([re]) => re.test(h))?.[1] ?? "ignore";
}
