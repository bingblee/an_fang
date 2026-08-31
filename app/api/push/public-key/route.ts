import { NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/push";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!getRuntimeConfig().remindersEnabled) return NextResponse.json({ error: "当前环境不发送系统提醒。" }, { status: 403 });
  return NextResponse.json({ publicKey: getVapidKeys().publicKey });
}
