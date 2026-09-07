import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "网页密码找回已停用，请联系服务器管理员。" }, { status: 410 });
}
