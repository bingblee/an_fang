import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createTopic, listTopics, topicSchema } from "@/lib/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ topics: listTopics(getDb()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const parsed = topicSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "话题信息不正确。" }, { status: 400 });
  const result = createTopic(getDb(), parsed.data);
  return NextResponse.json({ ...result, message: result.created ? `已创建话题：${result.topic.name}` : `话题已存在：${result.topic.name}` }, { status: result.created ? 201 : 200 });
}
