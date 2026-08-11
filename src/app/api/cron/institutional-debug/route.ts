import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { getFundRecentQuarters, getHoldingsForQuarters, getRecentGlobalQuarters } from "@/lib/db";
import { INSTITUTIONAL_FILERS } from "@/lib/institutionalFilers";

// Temporary diagnostic route — remove once the empty-consensus-in-prod mystery is solved.
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const globalQuarters = await getRecentGlobalQuarters(4);
  const holdings = await getHoldingsForQuarters(globalQuarters);
  const perFundQuarters = await getFundRecentQuarters();

  const fundQuarterSummary = INSTITUTIONAL_FILERS.map((f) => ({
    name: f.name,
    cik: f.cik,
    quarters: perFundQuarters.get(f.cik) ?? null,
  }));

  return NextResponse.json({
    globalQuarters,
    holdingsCount: holdings.length,
    sampleHoldings: holdings.slice(0, 5),
    fundQuarterSummary,
  });
}
