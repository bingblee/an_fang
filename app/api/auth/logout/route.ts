import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, requestOriginAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  await clearSessionCookie(request);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
