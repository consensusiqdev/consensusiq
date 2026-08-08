import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
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

export const metadata: Metadata = {
  title: "InsiderAlign — SEC Insider-Trading-Tracker",
  description:
    "Beobachtet SEC-Form-4-Insidergeschäfte und zeigt, wann mehrere Insider dieselbe Aktie kaufen oder verkaufen.",
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
        </head>
        <body className="min-h-full flex flex-col bg-bg text-text">{children}</body>
      </html>
    </ClerkProvider>
  );
}
