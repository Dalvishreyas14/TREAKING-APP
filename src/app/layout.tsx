import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";

import { SplashScreen } from "@/components/brand/splash-screen";
import { MotionProvider } from "@/components/providers/motion-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import "@/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "LIFEOS - Run Your Life With Intelligence",
    template: "%s · LIFEOS",
  },
  description:
    "One intelligent workspace for your goals, habits, tasks, fitness, study, routines and personal growth.",
  applicationName: "LIFEOS",
  // iOS reads these to launch the site as a standalone app once it has been
  // added to the home screen. `default` keeps the status bar legible over the
  // near-black dark canvas instead of forcing a translucent bar that would sit
  // white-on-white in the light theme.
  appleWebApp: {
    capable: true,
    title: "LIFEOS",
    statusBarStyle: "default",
  },
  // iOS uses this rather than the manifest icons when saving to the home screen.
  icons: {
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  formatDetection: { telephone: false },
  keywords: [
    "life tracker",
    "habit tracker",
    "productivity",
    "goal tracking",
    "daily planner",
    "AI coach",
    "focus timer",
  ],
  authors: [{ name: "LIFEOS" }],
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "LIFEOS",
    title: "LIFEOS - Run Your Life With Intelligence",
    description:
      "Plan your day. Build your habits. Understand your life.",
  },
  twitter: {
    card: "summary_large_image",
    title: "LIFEOS - Run Your Life With Intelligence",
    description:
      "Plan your day. Build your habits. Understand your life.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0f" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // globals.css sets `scroll-behavior: smooth` on this element, which is what
      // we want for in-page anchor jumps. The same rule would otherwise animate
      // every router navigation, including back/forward, which feels like lag.
      // This attribute is Next.js's opt-in for temporarily neutralizing the rule
      // during route transitions; without it Next.js logs a warning on each
      // navigation and leaves the animation on.
      data-scroll-behavior="smooth"
      className={cn(geistSans.variable, geistMono.variable)}
    >
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <SerwistProvider swUrl="/serwist/sw.js">
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <MotionProvider>
              {children}
              <Toaster />
              <SplashScreen />
            </MotionProvider>
          </ThemeProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
