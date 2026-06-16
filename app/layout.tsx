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
    apple: "/icons/apple-touch-icon.png",
    icon: [
      { url: "/icons/unloan-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/unloan-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icons/unloan-icon-192.png",
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
