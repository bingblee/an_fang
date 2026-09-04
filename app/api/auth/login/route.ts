import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  clearLoginFailures,
  createSession,
  findUser,
  loginBlocked,
  recordLoginFailure,
  requestOriginAllowed,
  runDummyPasswordCheck,
  setSessionCookie,
  verifyPassword
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
  remember: z.boolean().default(true)
});

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请输入用户名和密码。" }, { status: 400 });
  if (loginBlocked(request, parsed.data.username)) {
    return NextResponse.json(
      { error: "尝试次数过多，请 15 分钟后再试。" },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }
  const user = findUser(parsed.data.username);
  const valid = user
    ? await verifyPassword(parsed.data.password, user.password_hash, user.password_salt)
    : (await runDummyPasswordCheck(parsed.data.password), false);
  if (!user || !valid) {
    const failure = recordLoginFailure(request, parsed.data.username);
    return NextResponse.json(
      { error: failure.blocked ? "尝试次数过多，请 15 分钟后再试。" : "用户名或密码不正确。" },
      { status: failure.blocked ? 429 : 401, ...(failure.blocked ? { headers: { "Retry-After": "900" } } : {}) }
    );
  }
  clearLoginFailures(request, parsed.data.username);
  const session = createSession(user.id, parsed.data.remember);
  await setSessionCookie(request, session);
  return NextResponse.json(
    { ok: true, username: user.username },
    { headers: { "Cache-Control": "no-store" } }
  );
}
