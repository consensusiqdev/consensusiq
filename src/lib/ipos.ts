import "server-only";
import { getIpoFilings, getTickerHistory } from "@/lib/db";
import type { IpoListing } from "@/types/filing";

/**
 * Recorded IPOs newest first, each enriched with how many insiders subscribed to the offering
 * itself (see IpoListing's doc comment for exactly what that counts). One getTickerHistory() call
 * per IPO — deliberately not batched: the list is small and slow-growing (genuine first-time IPOs
 * are rare, see ipoDiscovery.ts), unlike screens.ts's per-screen signal recompute, which this is
 * NOT the same shape of problem as.
 */
export async function listIpos(): Promise<IpoListing[]> {
  const filings = await getIpoFilings();

  return Promise.all(
    filings.map(async (f) => {
      const history = await getTickerHistory(f.ticker);
      const subscribers = new Set(
        history.filter((t) => t.side === "BUY" && t.near_offering === 1).map((t) => t.filer_id)
      );

      return {
        ticker: f.ticker,
        companyName: f.company_name,
        cik: f.cik,
        filedDate: f.filed_date,
        sourceUrl: f.source_url,
        insiderSubscriberCount: subscribers.size,
        hasAnyActivity: history.length > 0,
      } satisfies IpoListing;
    })
  );
}
