import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multibagger — Daily Stock Picks",
  description: "Strong long-term and intraday stock recommendations powered by NIFTY 500 screening.",
};

export const viewport: Viewport = {
  initialScale: 1,
  maximumScale: 3,
  minimumScale: 1,
  userScalable: true,
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
