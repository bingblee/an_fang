import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "安放 · 个人 AI 外部大脑",
  description: "想到的事，先放在这里。",
  applicationName: "安放",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "安放"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f4f1e9"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

