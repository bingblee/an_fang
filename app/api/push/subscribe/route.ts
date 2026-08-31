import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512)
  })
});

export async function POST(request: NextRequest) {
  if (!getRuntimeConfig().remindersEnabled) return NextResponse.json({ error: "当前环境不发送系统提醒。" }, { status: 403 });
  const parsed = subscriptionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "提醒订阅信息无效。" }, { status: 400 });
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions
        (id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`
    )
    .run(
      randomUUID(),
      parsed.data.endpoint,
      parsed.data.keys.p256dh,
      parsed.data.keys.auth,
      request.headers.get("user-agent"),
      now,
      now
    );
  return NextResponse.json({ ok: true });
}
