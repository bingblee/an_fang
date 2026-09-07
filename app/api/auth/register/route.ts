import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSession,
  createUser,
  passwordProblem,
  requestOriginAllowed,
  setSessionCookie,
  usernameProblem
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
  remember: z.boolean().default(true)
});

export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请完整填写账号信息。" }, { status: 400 });
  }
  const usernameError = usernameProblem(parsed.data.username);
  const passwordError = passwordProblem(parsed.data.password);
  if (usernameError || passwordError) {
    return NextResponse.json({ error: usernameError || passwordError }, { status: 400 });
  }
  const user = await createUser(parsed.data.username, parsed.data.password);
  if (!user) {
    return NextResponse.json({ error: "这个用户名已经被使用。" }, { status: 409 });
  }
  const session = createSession(user.id, parsed.data.remember);
  await setSessionCookie(request, session);
  return NextResponse.json(
    { ok: true, username: user.username },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
