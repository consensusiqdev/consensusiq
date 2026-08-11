"use client";

import { useEffect } from "react";

/** Registers the no-op service worker (public/sw.js) so the site meets Chrome's PWA
 * installability criteria — see that file's doc comment for why it deliberately caches nothing. */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return null;
}
