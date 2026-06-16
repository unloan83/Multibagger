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
        src: "/unloan-logo.png",
        sizes: "1536x1024",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
