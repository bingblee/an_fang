import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "安放 · 个人 AI 外部大脑",
    short_name: "安放",
    description: "想到的事，先放在这里。",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f2",
    theme_color: "#f6f7f2",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
}
