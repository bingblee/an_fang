import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  changePassword,
  clearLoginFailures,
  createSession,
  findUser,
  loginBlocked,
  passwordProblem,
  recordLoginFailure,
  requestOriginAllowed,
  setSessionCookie,
  setupTokenMatches
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recoverySchema = z.object({
  setupToken: z.string().min(1).max(500),
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
  remember: z.boolean().default(true)
});

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  if (!process.env.AUTH_SETUP_TOKEN || process.env.AUTH_SETUP_TOKEN.length < 20) {
    return NextResponse.json({ error: "服务器尚未开启密码重置。" }, { status: 503 });
  }
  const parsed = recoverySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请完整填写重置信息。" }, { status: 400 });
  const attemptName = `recovery:${parsed.data.username}`;
  if (loginBlocked(request, attemptName)) {
    return NextResponse.json(
      { error: "尝试次数过多，请 15 分钟后再试。" },
      { status: 429, headers: { "Retry-After": "900" } }
    );
  }
  if (!setupTokenMatches(parsed.data.setupToken)) {
    const failure = recordLoginFailure(request, attemptName);
    return NextResponse.json(
      { error: failure.blocked ? "尝试次数过多，请 15 分钟后再试。" : "首次设置口令不正确。" },
      { status: failure.blocked ? 429 : 403 }
    );
  }
  const passwordError = passwordProblem(parsed.data.password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  const user = findUser(parsed.data.username);
  if (!user) return NextResponse.json({ error: "用户名不正确。" }, { status: 400 });
  clearLoginFailures(request, attemptName);
  await changePassword(user.id, parsed.data.password);
  const session = createSession(user.id, parsed.data.remember);
  await setSessionCookie(request, session);
  return NextResponse.json(
    { ok: true, message: "密码已重置，其他设备上的登录已退出。" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
