import type { MetadataRoute } from "next";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const testing = getRuntimeConfig().environment !== "production";
  return {
    name: testing ? "安放 · 测试环境" : "安放 · 个人 AI 外部大脑",
    short_name: testing ? "安放测试" : "安放",
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
