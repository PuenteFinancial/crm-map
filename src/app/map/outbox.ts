"use client";

import { useSyncExternalStore } from "react";
import { logVisit, type LogVisitInput } from "./actions";

// Visit logs made with no signal wait here (in this browser only) and are sent once back online.
// Each one records who logged it and is only ever sent from that person's session, so a phone
// shared between Joshua and Colton never syncs one person's visits under the other's login.

const KEY = "crm-map:outbox";
const EVENT = "crm-map:outbox-changed";

export type QueuedVisit = { key: string; userId: string; payload: LogVisitInput; contactName: string; queuedAt: string };

let currentUser: string | null = null;

/** Set from the signed-in session when the map loads. */
export function setOutboxUser(userId: string | null) {
  currentUser = userId;
  window.dispatchEvent(new Event(EVENT));
}

function mine(items: QueuedVisit[]) {
  return currentUser ? items.filter((q) => q.userId === currentUser) : [];
}

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

export function queueVisit(item: Omit<QueuedVisit, "userId">) {
  if (!currentUser) throw new Error("Not signed in, so the visit can't be saved for later.");
  write([...read(), { ...item, userId: currentUser }]);
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
      for (const item of mine(read())) {
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
  return useSyncExternalStore(subscribe, () => mine(read()).length, () => 0);
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
