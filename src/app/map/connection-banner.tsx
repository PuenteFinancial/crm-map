"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTime } from "@/lib/time";
import { flushOutbox, setOutboxUser, useOnline, useOutboxCount } from "./outbox";

const STALE_MS = 3 * 60 * 1000;

/**
 * Status pill under the top bar: offline, syncing queued visits, or "this is a saved copy"
 * (the service worker served the last saved page because the network was too slow).
 */
export function ConnectionBanner({ renderedAt, userId }: { renderedAt: number; userId: string | null }) {
  const online = useOnline();
  const pending = useOutboxCount();
  const router = useRouter();
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setOutboxUser(userId);
  }, [userId]);

  // Data rendered a while ago means a saved copy, or an app left open in the background.
  useEffect(() => {
    const check = () => setStale(Date.now() - renderedAt > STALE_MS);
    const timer = setTimeout(check, 0);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [renderedAt]);

  // Send queued visits as soon as there's a connection, then reload the data. A weak signal can
  // fail without the phone ever reporting "offline", so keep retrying while anything is waiting.
  useEffect(() => {
    if (!online || pending === 0) return;
    const flush = () => flushOutbox().then((sent) => sent > 0 && router.refresh());
    flush();
    const timer = setInterval(flush, 30_000);
    return () => clearInterval(timer);
  }, [online, pending, router]);

  const visits = `${pending} visit${pending === 1 ? "" : "s"}`;
  const pill = "pointer-events-auto self-start rounded-full px-3 py-1.5 text-sm shadow-sm";

  if (!online) {
    return (
      <p className={`${pill} bg-neutral-900 text-white`}>
        📶 Offline · saved data{pending > 0 ? ` · ${visits} waiting to sync` : ""}
      </p>
    );
  }
  if (pending > 0) return <p className={`${pill} bg-neutral-900 text-white`}>Syncing {visits}…</p>;
  if (stale) {
    return (
      <p className={`${pill} bg-white text-neutral-700`}>
        Data from {formatTime(new Date(renderedAt).toISOString())} ·{" "}
        <button onClick={() => router.refresh()} className="font-medium text-blue-600">Refresh</button>
      </p>
    );
  }
  return null;
}
