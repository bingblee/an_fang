import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "首次设置已停用，请使用账号密码登录。" }, { status: 410 });
}
