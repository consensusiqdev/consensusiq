const STORAGE_KEY = "insider-align-watchlist";

/** Free, no-login watchlist cap — more than this needs a subscription (server-synced watchlist,
 * unlimited, plus the email alerts the free tier doesn't get). See WatchButton.tsx / /watchlist. */
export const FREE_WATCHLIST_LIMIT = 5;

export function getLocalWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function saveLocalWatchlist(tickers: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tickers));
  } catch {
    // Storage unavailable/full — change just won't persist, same tolerance as the filter-persistence pattern in DashboardClient.tsx.
  }
}

export function isInLocalWatchlist(ticker: string): boolean {
  return getLocalWatchlist().includes(ticker.toUpperCase());
}

export type AddResult = "added" | "already-added" | "limit-reached";

export function addToLocalWatchlist(ticker: string): AddResult {
  const upper = ticker.toUpperCase();
  const current = getLocalWatchlist();
  if (current.includes(upper)) return "already-added";
  if (current.length >= FREE_WATCHLIST_LIMIT) return "limit-reached";
  saveLocalWatchlist([...current, upper]);
  return "added";
}

export function removeFromLocalWatchlist(ticker: string): void {
  const upper = ticker.toUpperCase();
  saveLocalWatchlist(getLocalWatchlist().filter((t) => t !== upper));
}
