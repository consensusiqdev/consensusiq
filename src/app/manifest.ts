import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/seo";

// App Router's file-convention manifest — auto-served at /manifest.webmanifest and auto-linked
// in <head>, same pattern as sitemap.ts/robots.ts already used in this project.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — SEC Insider-Trading-Tracker`,
    short_name: SITE_NAME,
    description:
      "Beobachtet SEC-Form-4-Insidergeschäfte und zeigt, wann mehrere Insider dieselbe Aktie kaufen oder verkaufen.",
    // The dashboard, not "/", is the actual tool — "/" only redirects there anyway (see
    // next.config.ts), so starting an installed app straight at "/" would just cost an extra hop.
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    lang: "de",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
