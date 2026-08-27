"use client";

import { useEffect, useState } from "react";
import Spinner from "@/components/ui/Spinner";
import type { DigestFrequency, DigestPreferenceRow } from "@/lib/db";

type Choice = "off" | DigestFrequency;

export default function DigestPreferenceClient() {
  const [choice, setChoice] = useState<Choice>("off");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/digest-preference")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
        const pref = body.preference as DigestPreferenceRow | null;
        setChoice(pref?.frequency ?? "off");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"))
      .finally(() => setLoading(false));
  }, []);

  async function handleChange(next: Choice) {
    setError(null);
    setSaving(true);
    try {
      const res =
        next === "off"
          ? await fetch("/api/digest-preference", { method: "DELETE" })
          : await fetch("/api/digest-preference", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ frequency: next }),
            });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
      setChoice(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <p className="flex items-center gap-2 font-mono text-[12.5px] text-text-faint">
        <Spinner className="h-3.5 w-3.5" />
        Lädt…
      </p>
    );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={choice}
        disabled={saving}
        onChange={(e) => handleChange(e.target.value as Choice)}
        className="rounded-md border border-border bg-bg-panel-2 px-3 py-2 font-mono text-[13px] text-text outline-none focus:border-accent disabled:opacity-50"
      >
        <option value="off">Aus</option>
        <option value="daily">Täglich</option>
        <option value="weekly">Wöchentlich</option>
      </select>
      <span className="font-mono text-[11.5px] text-text-faint">
        Top-5-Signale der letzten 24h/7 Tage, zusätzlich zu deinen Watchlist- und Screen-Alerts.
      </span>
      {error && <span className="font-mono text-[12.5px] text-no">{error}</span>}
    </div>
  );
}
