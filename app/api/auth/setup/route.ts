import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createOwner,
  createSession,
  hasOwnerAccount,
  passwordProblem,
  requestOriginAllowed,
  setSessionCookie,
  setupTokenMatches,
  usernameProblem
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const setupSchema = z.object({
  setupToken: z.string().min(1).max(500),
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
  remember: z.boolean().default(true)
});

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  if (hasOwnerAccount()) {
    return NextResponse.json({ error: "主人账号已经创建，请直接登录。" }, { status: 409 });
  }
  if (!process.env.AUTH_SETUP_TOKEN || process.env.AUTH_SETUP_TOKEN.length < 20) {
    return NextResponse.json(
      { error: "服务器还没有配置首次设置口令。" },
      { status: 503 }
    );
  }
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请完整填写账号信息。" }, { status: 400 });
  if (!setupTokenMatches(parsed.data.setupToken)) {
    return NextResponse.json({ error: "首次设置口令不正确。" }, { status: 403 });
  }
  const usernameError = usernameProblem(parsed.data.username);
  const passwordError = passwordProblem(parsed.data.password);
  if (usernameError || passwordError) {
    return NextResponse.json({ error: usernameError || passwordError }, { status: 400 });
  }
  const user = await createOwner(parsed.data.username, parsed.data.password);
  if (!user) return NextResponse.json({ error: "主人账号已经创建，请直接登录。" }, { status: 409 });
  const session = createSession(user.id, parsed.data.remember);
  await setSessionCookie(request, session);
  return NextResponse.json(
    { ok: true, username: user.username },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
