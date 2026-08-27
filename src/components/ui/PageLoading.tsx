import Spinner from "./Spinner";

/** Fallback for a route segment's loading.tsx. These routes (see `instant = false` in their
 * page.tsx) can't produce a static shell — without this, navigating to one showed nothing at all
 * until the dynamic render finished, indistinguishable from the page being broken. */
export default function PageLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg text-text">
      <div className="flex items-center gap-3 font-mono text-[13px] text-text-dim">
        <Spinner className="h-5 w-5 text-accent" />
        Lädt…
      </div>
    </main>
  );
}
