"use client";

import { useEffect } from "react";

// Registers public/sw.js in production builds (in dev it would cache pages mid-edit).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => console.error("service worker failed", err));
  }, []);
  return null;
}
