"use client";

import { useEffect, useState } from "react";
import Spinner from "@/components/ui/Spinner";

type Status = "checking" | "unsupported" | "off" | "on" | "denied";

/** Web Push's applicationServerKey wants a raw BufferSource, but VAPID public keys are handed out
 * URL-safe-base64 — standard boilerplate conversion, no library for something this small. Typed
 * as ArrayBuffer (not Uint8Array) since TS's current DOM lib types don't consider a plain
 * Uint8Array's ArrayBufferLike backing assignable to PushManager.subscribe()'s BufferSource param. */
function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer as ArrayBuffer;
}

export default function PushSubscribeButton() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, []);

  async function enable() {
    setError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      });
      const json = sub.toJSON();

      const res = await fetch("/api/push-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Fehler ${res.status}`);
      setStatus("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push-subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking")
    return (
      <p className="flex items-center gap-2 font-mono text-[12.5px] text-text-faint">
        <Spinner className="h-3.5 w-3.5" />
        Lädt…
      </p>
    );

  if (status === "unsupported") {
    return (
      <p className="font-mono text-[12.5px] text-text-faint">
        Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.
      </p>
    );
  }

  if (status === "denied") {
    return (
      <p className="font-mono text-[12.5px] text-text-faint">
        Benachrichtigungen sind für diese Seite in deinem Browser blockiert — Berechtigung in den
        Browser-Einstellungen ändern, um Push zu aktivieren.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={status === "on" ? disable : enable}
        disabled={busy}
        className="rounded-md border border-border bg-bg-panel-2 px-3 py-2 font-mono text-[13px] text-text outline-none transition hover:border-accent disabled:opacity-50"
      >
        {busy ? "…" : status === "on" ? "Deaktivieren" : "Aktivieren"}
      </button>
      <span className="font-mono text-[11.5px] text-text-faint">
        {status === "on"
          ? "Push-Benachrichtigungen für dieses Gerät sind aktiv."
          : "Sofortige Browser-Benachrichtigungen bei Watchlist- und Screen-Treffern, zusätzlich zur E-Mail."}
      </span>
      {error && <span className="font-mono text-[12.5px] text-no">{error}</span>}
    </div>
  );
}
