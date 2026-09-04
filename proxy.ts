import { NextRequest, NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth";

const publicPaths = new Set([
  "/login",
  "/register",
  "/setup",
  "/recover",
  "/manifest.webmanifest",
  "/sw.js",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/auth-sanctuary.jpg"
]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const publicRequest = publicPaths.has(pathname) || pathname.startsWith("/api/auth/");
  if (publicRequest || request.cookies.has(sessionCookieName)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "请先登录后再使用。" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
