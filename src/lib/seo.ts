import type { Metadata } from "next";

// The real, current production domain — NOT `NEXT_PUBLIC_APP_URL`, which still points at a dead
// ngrok tunnel and is only read by email.ts/twitterBot.ts/lemonsqueezy.ts for unrelated purposes.
export const SITE_URL = "https://insider-align.com";
export const SITE_NAME = "InsiderAlign";

// The site isn't actually meant to be found yet — the user is 17, and Impressum/real payments
// are blocked on turning 18 (see project memory). All the SEO plumbing (sitemap, metadata,
// JSON-LD) is built and ready, but search engines must not index it until that's resolved —
// the Impressum is still a placeholder, and being findable while it says
// "[Name/Firma, siehe Impressum]" isn't acceptable. Flip this to `true` once ready to launch —
// it's read by both robots.ts (blocks crawling entirely while false) and the root layout's
// sitewide `noindex` meta tag (defense in depth in case some crawler ignores robots.txt).
export const SITE_INDEXABLE = false;

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString();
}

/** Consistent title/description/canonical/OpenGraph/Twitter-card metadata for a single page. */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "de_DE",
      type: "website",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}
