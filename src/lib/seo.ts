import type { Metadata } from "next";

// The real, current production domain — NOT `NEXT_PUBLIC_APP_URL`, which still points at a dead
// ngrok tunnel and is only read by email.ts/twitterBot.ts/lemonsqueezy.ts for unrelated purposes.
export const SITE_URL = "https://insider-align.com";
export const SITE_NAME = "InsiderAlign";

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
