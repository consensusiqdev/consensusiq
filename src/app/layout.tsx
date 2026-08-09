import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { SITE_INDEXABLE, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const DESCRIPTION =
  "Beobachtet SEC-Form-4-Insidergeschäfte und zeigt, wann mehrere Insider dieselbe Aktie kaufen oder verkaufen.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // A plain string, not a { default, template } object — every page in this codebase already
  // writes its own full "X | InsiderAlign" title (see /methodik, /institutional), so a template
  // here would double up the suffix instead of composing with it.
  title: `${SITE_NAME} — SEC Insider-Trading-Tracker`,
  description: DESCRIPTION,
  openGraph: {
    title: `${SITE_NAME} — SEC Insider-Trading-Tracker`,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "de_DE",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — SEC Insider-Trading-Tracker`,
    description: DESCRIPTION,
  },
  // Sitewide noindex while SITE_INDEXABLE is false (see its doc comment in seo.ts) — belt and
  // suspenders alongside robots.ts's full Disallow, in case some crawler ignores robots.txt.
  // No individual page sets its own `robots` field, so this value applies everywhere unchanged.
  ...(SITE_INDEXABLE ? {} : { robots: { index: false, follow: false } }),
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
};

const WEBSITE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider
      // @clerk/themes (2.4.x) still bundles its own older @clerk/shared (3.x), one major behind
      // @clerk/nextjs's (4.x) — its `Theme`/`Appearance` types no longer structurally match what
      // @clerk/nextjs expects (baseTheme isn't even a recognized key on the newer type anymore),
      // even though the same object works fine at runtime. Pure type-layer drift between the two
      // packages' independent @clerk/shared copies, not a real incompatibility — cast the whole
      // prop rather than chase every renamed/removed field individually.
      appearance={{
        baseTheme: dark,
        variables: {
          colorBackground: "var(--bg-panel)",
          colorPrimary: "var(--accent)",
          colorForeground: "var(--text)",
          colorMutedForeground: "var(--text-dim)",
          colorInput: "var(--bg-panel-2)",
          colorInputForeground: "var(--text)",
          colorNeutral: "var(--text-dim)",
          borderRadius: "0.5rem",
        },
        elements: {
          userPreviewMainIdentifier: { color: "var(--text)" },
          userPreviewSecondaryIdentifier: { color: "var(--text-dim)" },
          userButtonPopoverActionButtonText: { color: "var(--text)" },
          userButtonPopoverActionButtonIcon: { color: "var(--text-dim)" },
          userButtonPopoverFooter: { color: "var(--text-dim)" },
          formFieldLabel: { color: "var(--text-dim)" },
          identityPreviewText: { color: "var(--text)" },
          identityPreviewEditButton: { color: "var(--accent)" },
          headerTitle: { color: "var(--text)" },
          headerSubtitle: { color: "var(--text-dim)" },
          dividerText: { color: "var(--text-dim)" },
          footerActionText: { color: "var(--text-dim)" },
          socialButtonsBlockButtonText: { color: "var(--text)" },
          formFieldInput: {
            backgroundColor: "var(--bg-panel-2)",
            color: "var(--text)",
            borderColor: "var(--border)",
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any}
    >
      <html
        lang="de"
        suppressHydrationWarning
        className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} h-full antialiased`}
      >
        <head>
          <Script id="theme-init" strategy="beforeInteractive">
            {THEME_INIT_SCRIPT}
          </Script>
          <script
            type="application/ld+json"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
          />
          <script
            type="application/ld+json"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSON_LD) }}
          />
        </head>
        <body className="min-h-full flex flex-col bg-bg text-text">
          {children}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
