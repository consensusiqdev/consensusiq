import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { getAllTickers } from "@/lib/db";
import { listIndustries } from "@/lib/sectors";

const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  // "/" itself just redirects to "/dashboard" now (see next.config.ts) — not listed here, a
  // redirecting URL doesn't belong in a sitemap.
  { path: "/dashboard", priority: 1, changeFrequency: "hourly" },
  { path: "/ueber", priority: 0.5, changeFrequency: "monthly" },
  { path: "/sector", priority: 0.7, changeFrequency: "daily" },
  { path: "/institutional", priority: 0.6, changeFrequency: "daily" },
  { path: "/methodik", priority: 0.4, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.5, changeFrequency: "monthly" },
  { path: "/impressum", priority: 0.2, changeFrequency: "yearly" },
  { path: "/datenschutz", priority: 0.2, changeFrequency: "yearly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const [tickers, industries] = await Promise.all([getAllTickers(), listIndustries()]);

  const tickerEntries: MetadataRoute.Sitemap = tickers.map((ticker) => ({
    url: `${SITE_URL}/company/${ticker}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.6,
  }));

  const sectorEntries: MetadataRoute.Sitemap = industries.map(({ slug }) => ({
    url: `${SITE_URL}/sector/${slug}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.5,
  }));

  return [...staticEntries, ...tickerEntries, ...sectorEntries];
}
