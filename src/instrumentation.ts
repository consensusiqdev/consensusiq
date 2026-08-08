export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // On Vercel, scheduling happens via /api/cron/* routes (see vercel.json + the external
  // cron-job.org jobs) — a serverless invocation suspends shortly after the request completes, so
  // setInterval loops here would never actually fire in production. Local `npm run dev`/`npm run
  // start` still gets the original "just works, no external cron needed" behavior below.
  if (process.env.VERCEL) return;

  const g = globalThis as unknown as { __insiderAlignIngestStarted?: boolean };
  if (g.__insiderAlignIngestStarted) return;
  g.__insiderAlignIngestStarted = true;

  const { runIngestCycle, runInstitutionalCycle, runBackfillCycle } = await import("@/lib/cronJobs");

  const INTERVAL_MS = 5 * 60 * 1000;
  const INSTITUTIONAL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 13F is quarterly — no reason to poll faster
  const BACKFILL_INTERVAL_MS = 3 * 60 * 1000; // one company's full insider history per tick

  const safeRunIngestCycle = () => runIngestCycle().catch((err) => console.error("[ingest] fehlgeschlagen:", err));

  safeRunIngestCycle();
  runInstitutionalCycle().catch((err) => console.error("[institutional] fehlgeschlagen:", err));
  runBackfillCycle().catch((err) => console.error("[insiderPositions] Backfill fehlgeschlagen:", err));

  setInterval(safeRunIngestCycle, INTERVAL_MS);
  setInterval(() => runInstitutionalCycle().catch((err) => console.error("[institutional] fehlgeschlagen:", err)), INSTITUTIONAL_INTERVAL_MS);
  setInterval(() => runBackfillCycle().catch((err) => console.error("[insiderPositions] Backfill fehlgeschlagen:", err)), BACKFILL_INTERVAL_MS);
}
