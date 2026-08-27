"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import type { SavedScreenRow } from "@/lib/db";

export default function SavedScreensClient() {
  const [screens, setScreens] = useState<SavedScreenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/screens")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
        setScreens(body.screens);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Unbekannter Fehler"))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: number) {
    setError(null);
    try {
      const res = await fetch(`/api/screens?id=${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Fehler ${res.status}`);
      setScreens(body.screens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
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
    <div>
      {error && <p className="mb-3 font-mono text-[12.5px] text-no">{error}</p>}

      {screens.length === 0 ? (
        <p className="font-mono text-[12.5px] leading-relaxed text-text-faint">
          Noch keine Screens gespeichert. Stell auf dem{" "}
          <Link href="/dashboard" className="text-accent hover:underline">
            Dashboard
          </Link>{" "}
          deine Filter ein und klick „Screen speichern“ — du bekommst dann eine E-Mail, sobald eine
          neue Aktie in dieses Bild passt.
        </p>
      ) : (
        <ul className="space-y-2">
          {screens.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-panel-2 px-3.5 py-2.5"
            >
              <div>
                <div className="font-mono text-[13px] text-text">{s.name}</div>
                <div className="mt-0.5 font-mono text-[11px] text-text-faint">
                  {s.window_days} Tage · min. {s.min_agree} Insider · min. $
                  {s.min_usd.toLocaleString("de-DE")}
                  {s.buys_only === 1 ? " · nur Käufe" : ""}
                  {s.c_suite_only === 1 ? " · nur C-Suite" : ""}
                  {s.industry ? ` · ${s.industry}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(s.id)}
                aria-label={`${s.name} löschen`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-faint hover:bg-bg-hover hover:text-no"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
