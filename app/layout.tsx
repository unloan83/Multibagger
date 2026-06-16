import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaExperienceControls } from "@/components/pwa-experience-controls";
import "./globals.css";

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "UNLOAN",
  },
  title: "UNLOAN",
  description: "Build Wealth. Reduce Debt. Create Freedom.",
  icons: {
    apple: "/unloan-logo.png",
    icon: "/unloan-logo.png",
    shortcut: "/unloan-logo.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 0.5,
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
      <body>
        <PwaExperienceControls />
        {children}
      </body>
    </html>
  );
}
