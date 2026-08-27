/** Minimal rotating-notch spinner. Sizing and color are the caller's job via `className` (e.g.
 * `h-4 w-4 text-accent`) — the border itself uses `currentColor`, so it also just inherits a
 * surrounding text color class for free. */
export default function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Lädt"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
