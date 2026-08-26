import { NextResponse } from "next/server";
import { cacheLife } from "next/cache";
import { getAllCompanies } from "@/lib/db";

/**
 * Must stay a cached helper rather than caching the GET export itself — the `use cache` directive
 * can't be applied to the handler export. Without it this route prerenders at build time and
 * NEVER revalidates (`initialRevalidateSeconds: false` in the prerender manifest), which would
 * freeze the company list until the next deploy: a ticker the ingest picks up tomorrow would
 * never show up in the search box. An hour of staleness is fine — new companies appear rarely.
 */
async function getCompanyList() {
  "use cache";
  cacheLife("dailyRefresh");

  const rows = await getAllCompanies();
  return rows.map((r) => ({ ticker: r.ticker, companyName: r.company_name }));
}

// Public endpoint, same reasoning as /api/signals etc. — no auth gate. Powers the company-search
// box (src/components/ui/CompanySearch.tsx), which fetches the full list once and filters
// client-side rather than round-tripping per keystroke.
export async function GET() {
  const companies = await getCompanyList();
  return NextResponse.json({ companies });
}
