// Mirrors the enums in supabase/migrations/20261024000000_init.sql.
export const CATEGORIES = ["founder", "financier", "supply-chain", "other"] as const;
export const PRIORITIES = ["must-see", "want-to-see", "if-nearby"] as const;
export const STAGES = [
  "identified", "contacted", "replied", "call-booked", "talked",
  "asked", "committed", "paid", "lost", "nurture",
] as const;
export const COMPANY_KINDS = ["prospect", "partner", "investor", "inspiration"] as const;
export const OWNERS = ["joshua", "colton"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Stage = (typeof STAGES)[number];
export type CompanyKind = (typeof COMPANY_KINDS)[number];
export type Owner = (typeof OWNERS)[number];

// exact/street: good enough to drive to. city: rough area only. low: needs a human to fix the pin.
export type GeocodeConfidence = "exact" | "street" | "city" | "low" | "manual";
