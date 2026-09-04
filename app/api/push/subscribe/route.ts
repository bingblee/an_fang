import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getRuntimeConfig } from "@/lib/runtime-config.mjs";
import { getCurrentSessionTokenHash, requireApiSession } from "@/lib/auth";

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
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  if (!getRuntimeConfig().remindersEnabled) return NextResponse.json({ error: "当前环境不发送系统提醒。" }, { status: 403 });
  const parsed = subscriptionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "提醒订阅信息无效。" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const sessionTokenHash = await getCurrentSessionTokenHash();
  if (!sessionTokenHash) return NextResponse.json({ error: "登录状态已失效。" }, { status: 401 });
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions
        (id, user_id, endpoint, p256dh, auth, session_token_hash, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         session_token_hash = excluded.session_token_hash,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`
    )
    .run(
      randomUUID(),
      auth.session.userId,
      parsed.data.endpoint,
      parsed.data.keys.p256dh,
      parsed.data.keys.auth,
      sessionTokenHash,
      request.headers.get("user-agent"),
      now,
      now
    );
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  const parsed = z.object({ endpoint: z.string().url().max(4096) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提醒订阅信息无效。" }, { status: 400 });
  const sessionTokenHash = await getCurrentSessionTokenHash();
  if (!sessionTokenHash) return NextResponse.json({ error: "登录状态已失效。" }, { status: 401 });
  getDb().prepare(
    "DELETE FROM push_subscriptions WHERE endpoint = ? AND session_token_hash = ? AND user_id = ?"
  ).run(parsed.data.endpoint, sessionTokenHash, auth.session.userId);
  return NextResponse.json({ ok: true });
}
