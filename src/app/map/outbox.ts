"use client";

import { useSyncExternalStore } from "react";
import { logVisit, type LogVisitInput } from "./actions";

// Visit logs made with no signal wait here (in this browser only) and are sent once back online.

const KEY = "crm-map:outbox";
const EVENT = "crm-map:outbox-changed";

export type QueuedVisit = { key: string; payload: LogVisitInput; contactName: string; queuedAt: string };

function read(): QueuedVisit[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedVisit[];
  } catch {
    return [];
  }
}

function write(items: QueuedVisit[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage blocked or full: nothing more we can do offline.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function queueVisit(item: QueuedVisit) {
  write([...read(), item]);
}

/** True when a failed server action call looks like "no connection" rather than a real error. */
export function isNetworkError(err: unknown) {
  return !navigator.onLine || err instanceof TypeError;
}

let flushing: Promise<number> | null = null;

/** Sends queued visits in order. Returns how many were sent; stops at the first failure. */
export function flushOutbox(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      for (const item of read()) {
        try {
          await logVisit(item.payload);
        } catch (err) {
          if (isNetworkError(err)) break;
          console.error("dropping queued visit that the server rejected", item, err);
        }
        write(read().filter((q) => q.key !== item.key));
        sent++;
      }
    } finally {
      flushing = null;
    }
    return sent;
  })();
  return flushing;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useOutboxCount() {
  return useSyncExternalStore(subscribe, () => read().length, () => 0);
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}
