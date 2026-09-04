import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  changePassword,
  createSession,
  findUserById,
  passwordProblem,
  requireApiSession,
  setSessionCookie,
  verifyPassword
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200)
});

export async function PATCH(request: NextRequest) {
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  const parsed = passwordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请完整填写密码。" }, { status: 400 });
  const passwordError = passwordProblem(parsed.data.newPassword);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return NextResponse.json({ error: "新密码需要与当前密码不同。" }, { status: 400 });
  }
  const current = auth.session;
  const user = findUserById(current.userId);
  if (!user || !(await verifyPassword(parsed.data.currentPassword, user.password_hash, user.password_salt))) {
    return NextResponse.json({ error: "当前密码不正确。" }, { status: 401 });
  }
  await changePassword(current.userId, parsed.data.newPassword);
  const session = createSession(current.userId, current.remembered);
  await setSessionCookie(request, session);
  return NextResponse.json(
    { ok: true, message: "密码已更新，其他设备上的登录已退出。" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
