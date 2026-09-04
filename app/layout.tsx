import type { Metadata, Viewport } from "next";
import "./globals.css";
import { themeColors, themeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "安放 · 个人 AI 外部大脑",
  description: "想到的事，先放在这里。",
  applicationName: "安放",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "安放"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: themeColors.light,
  colorScheme: "light dark"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head><script id="anfang-theme-init" dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
