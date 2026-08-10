import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dashboard is free and needs no login, so the old marketing landing page just added an
  // extra click before visitors reached the actual tool (real bounce-rate concern, discussed
  // 2026-08-10) — its content lives on at /ueber for anyone who wants the explainer first.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default nextConfig;
