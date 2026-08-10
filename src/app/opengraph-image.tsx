import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: "#0b0d10",
          padding: "90px",
        }}
      >
        <div style={{ display: "flex", gap: 10, marginBottom: 36 }}>
          <div style={{ width: 24, height: 50, background: "#8a672c", borderRadius: 7, display: "flex" }} />
          <div style={{ width: 24, height: 84, background: "#c28a34", borderRadius: 7, display: "flex" }} />
          <div style={{ width: 24, height: 124, background: "#e3a63e", borderRadius: 7, display: "flex" }} />
        </div>
        <div style={{ fontSize: 76, fontWeight: 700, color: "#e7e9ec", display: "flex" }}>InsiderAlign</div>
        <div style={{ fontSize: 32, color: "#8b939f", marginTop: 22, display: "flex", maxWidth: 920 }}>
          SEC-Insider-Trading-Tracker — sieht, wann mehrere Insider unabhängig voneinander dieselbe
          Aktie kaufen oder verkaufen.
        </div>
      </div>
    ),
    { ...size }
  );
}
