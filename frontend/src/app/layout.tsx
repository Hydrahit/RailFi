import type { Metadata, Viewport } from "next";
import { Syne, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { Providers } from "./providers";
import { assertNoForbiddenPublicSecrets } from "@/lib/server-env";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: { default: "RailFi", template: "%s - RailFi" },
  description: "On-chain USDC to UPI settlement on Solana. Offramp crypto to any Indian bank in seconds.",
  keywords: ["Solana", "USDC", "UPI", "crypto", "offramp", "India", "DeFi"],
  authors: [{ name: "RailFi" }],
  openGraph: {
    type: "website",
    title: "RailFi - USDC to UPI Settlement",
    description: "On-chain USDC offramp to any Indian UPI ID. Powered by Solana.",
    siteName: "RailFi",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#161616",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  assertNoForbiddenPublicSecrets();

  return (
    <html lang="en" className={`${syne.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
