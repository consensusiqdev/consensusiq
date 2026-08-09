import { NextResponse } from "next/server";
import { getAllCompanies } from "@/lib/db";

// Public endpoint, same reasoning as /api/signals etc. — no auth gate. Powers the company-search
// box (src/components/ui/CompanySearch.tsx), which fetches the full list once and filters
// client-side rather than round-tripping per keystroke.
export async function GET() {
  const rows = await getAllCompanies();
  const companies = rows.map((r) => ({ ticker: r.ticker, companyName: r.company_name }));
  return NextResponse.json({ companies });
}
