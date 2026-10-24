import { CATEGORY_COLORS } from "@/lib/contacts";
import type { Category } from "@/lib/types";

export function Dot({ category }: { category: Category }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[category] }} />;
}
