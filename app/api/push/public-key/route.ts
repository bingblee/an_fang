import { NextRequest, NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/push";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";
import { requireApiSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  if (!getRuntimeConfig().remindersEnabled) return NextResponse.json({ error: "当前环境不发送系统提醒。" }, { status: 403 });
  return NextResponse.json({ publicKey: getVapidKeys().publicKey });
}
