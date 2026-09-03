import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ErrorReporter } from "../components/ErrorReporter";
import { ViewportLock } from "../components/ViewportLock";
import { THEME_BOOT_SCRIPT } from "../lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", display: "swap" });

export const metadata: Metadata = {
  title: "OpenCall",
  description: "Open-source rundown and show-calling for live events.",
};

/**
 * Phones and tablets are show-critical surfaces: a stray pinch or a
 * double-tap must never leave a crew member zoomed into a corner of the run
 * sheet mid-show. The layout is responsive instead, and `viewport-fit` lets
 * full-bleed surfaces reach under the notch.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0d10",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the boot script below stamps data-theme on
    // this element before React arrives, and the server cannot know what a
    // browser chose. Without it every light-mode load would be a #418.
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <body>
        {/* Before first paint, before hydration: see THEME_BOOT_SCRIPT. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <ErrorReporter />
        <ViewportLock />
        {children}
      </body>
    </html>
  );
}
