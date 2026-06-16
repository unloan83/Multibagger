import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UNLOAN",
    short_name: "UNLOAN",
    description: "Build Wealth. Reduce Debt. Create Freedom.",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#1E88E5",
    icons: [
      {
        src: "/unloan-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
