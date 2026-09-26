"use client";

import { useEffect } from "react";

/** Registers the offline service worker in production builds only (dev caching fights HMR). */
export function RegisterSW() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((e) => console.warn("[sw] registration failed", e));
  }, []);
  return null;
}

/** Drop cached per-user data (call on sign-out so the next user never sees it offline). */
export function clearOfflineUserData(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage("clear-user-data");
  } catch {
    /* no service worker */
  }
}
