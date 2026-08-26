import { ImageResponse } from "next/og";
import { getTickerSummary } from "@/lib/tickerDetail";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function scoreColor(score: number): string {
  const abs = Math.abs(score);
  if (abs >= 80) return score >= 0 ? "#35c488" : "#e1615b";
  if (abs >= 50) return "#8b939f";
  return "#565d68";
}

function fmtScore(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

export default async function Image({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const summary = await getTickerSummary(ticker);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0b0d10",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
            <div style={{ fontSize: 100, fontWeight: 700, color: "#e3a63e", display: "flex" }}>{ticker}</div>
            <div style={{ fontSize: 42, color: "#8b939f", display: "flex", maxWidth: 620 }}>{summary.companyName}</div>
          </div>
          {summary.industry && (
            <div style={{ marginTop: 18, fontSize: 26, color: "#565d68", display: "flex" }}>{summary.industry}</div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          {summary.signalScore != null ? (
            <>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  border: `3px solid ${scoreColor(summary.signalScore)}`,
                  borderRadius: 18,
                  padding: "18px 34px",
                  marginRight: 40,
                }}
              >
                <div style={{ fontSize: 68, fontWeight: 700, color: scoreColor(summary.signalScore), display: "flex" }}>
                  {fmtScore(summary.signalScore)}
                </div>
                <div style={{ fontSize: 20, color: "#8b939f", display: "flex" }}>SIGNAL SCORE</div>
              </div>
              <div style={{ fontSize: 32, color: "#e7e9ec", display: "flex" }}>
                {summary.leadCount} Insider auf der {summary.leadSide === "BUY" ? "Kauf" : "Verkauf"}-Seite
              </div>
            </>
          ) : (
            <div style={{ fontSize: 32, color: "#8b939f", display: "flex" }}>
              Kein aktives Signal in den letzten 30 Tagen
            </div>
          )}
        </div>

        <div style={{ fontSize: 28, color: "#565d68", display: "flex" }}>InsiderAlign · SEC Form 4</div>
      </div>
    ),
    { ...size }
  );
}
