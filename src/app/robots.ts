import type { MetadataRoute } from "next";
import { SITE_INDEXABLE, SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  if (!SITE_INDEXABLE) {
    // Site isn't meant to be found yet — see SITE_INDEXABLE's doc comment in seo.ts. No
    // sitemap reference here either, since there's no reason to point crawlers at it while
    // everything is disallowed anyway.
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/watchlist", "/sign-in", "/sign-up"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
