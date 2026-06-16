import type { Metadata } from "next";
import type { ReactNode } from "react";
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
    apple: "/unloan-icon.svg",
    icon: "/unloan-icon.svg",
    shortcut: "/unloan-icon.svg",
  },
  manifest: "/manifest.webmanifest",
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
