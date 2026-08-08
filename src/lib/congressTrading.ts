import type { Transaction } from "@/types/filing";

/**
 * Stub: no live, legally-clean data source is currently available.
 * `senate-stock-watcher-data` has been dead since 2021 (no data past 2020-12-02),
 * and efdsearch.senate.gov blocks unauthenticated automated access (Akamai 403).
 * House disclosures are PDF-only with no working open feed. Revisit if a real
 * source appears — the rest of the pipeline (types, DB, API `source` param)
 * is already source-agnostic so this can be filled in without another rework.
 */
export async function fetchCongressTransactions(): Promise<Transaction[]> {
  return [];
}
