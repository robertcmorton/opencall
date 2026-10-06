import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ErrorReporter } from "../components/ErrorReporter";
import { ViewportLock } from "../components/ViewportLock";
import { DialogHost } from "../components/DialogHost";
import { THEME_BOOT_SCRIPT } from "../lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", display: "swap" });

export const metadata: Metadata = {
  title: "OpenCall",
  description: "Open-source rundown and show-calling for live events.",
};

/**
 * Pinch-zoom is ALLOWED (6 Oct, Robert's decision): people with low vision
 * enlarge text that way, and blocking it everywhere failed the accessibility
 * check outright (WCAG 1.4.4). The one place a stray pinch is dangerous — the
 * show page while a show is live — locks it for that time only; see
 * `useZoomLock`. Double-tap zoom stays off everywhere (`touch-action:
 * manipulation`), and `viewport-fit` lets full-bleed surfaces reach under the
 * notch.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0d10",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The Content Security Policy's nonce for this request (see proxy.ts): the
  // one inline script of ours must carry it or the browser will not run it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: the boot script below stamps data-theme on
    // this element before React arrives, and the server cannot know what a
    // browser chose. Without it every light-mode load would be a #418.
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`} suppressHydrationWarning>
      <body>
        {/* Before first paint, before hydration: see THEME_BOOT_SCRIPT. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <ErrorReporter />
        <ViewportLock />
        <DialogHost />
        {children}
      </body>
    </html>
  );
}
