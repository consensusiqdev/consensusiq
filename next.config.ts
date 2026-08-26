import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard is free and needs no login, so the old marketing landing page just added an
  // extra click before visitors reached the actual tool (real bounce-rate concern, discussed
  // 2026-08-10) — its content lives on at /ueber for anyone who wants the explainer first.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
  cacheComponents: true,
  // Named profiles for cacheLife() calls, matching the exact `revalidate` windows the app used
  // before migrating off route segment configs — see docs/cache-components-migration.md.
  cacheLife: {
    // Dashboard initial data: new Form-4 filings ingest every 5 min (see cron/ingest).
    ingestCadence: { stale: 60, revalidate: 300, expire: 3600 },
    // Public/SEO pages (company, compare, sector): keeps crawler/refresh load off the DB.
    publicIsr: { stale: 300, revalidate: 1800, expire: 86400 },
    // Institutional 13F data and the rarely-changing methodology page: refreshes 1x/24h server-side.
    dailyRefresh: { stale: 300, revalidate: 3600, expire: 86400 },
  },
};

export default nextConfig;
