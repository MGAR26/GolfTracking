import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Golf Trip OS",
    short_name: "Golf Trip",
    description: "Scoring, handicaps, games, side bets and settlement for golf trips.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe6",
    theme_color: "#1f5a3c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
