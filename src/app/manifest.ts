import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Golf Trip OS",
    short_name: "Golf Trip",
    description: "Scoring, handicaps, games, side bets and settlement for golf trips.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f3ea",
    theme_color: "#1b2a41",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
