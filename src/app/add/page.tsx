import Link from "next/link";
import { QuickAddForm } from "./quick-add-form";

export default function AddPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Add contact</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">Done</Link>
      </header>
      <QuickAddForm />
    </main>
  );
}
