import { NextRequest, NextResponse } from "next/server";
import { getDb, itemSelect, mapItem } from "@/lib/db";
import { listTopics, topicNameKey, topicSchema } from "@/lib/topics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = getDb();
  const topic = listTopics(db).find((entry) => entry.id === id);
  if (!topic) return NextResponse.json({ error: "没有找到这个话题。" }, { status: 404 });
  const rows = db.prepare(`${itemSelect} WHERE i.topic_id = ? AND i.status NOT IN ('merged', 'abandoned')
    ORDER BY CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END,
    CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
    COALESCE(i.scheduled_for, '9999'), i.created_at DESC`).all(id) as Record<string, string | number | null>[];
  return NextResponse.json({ topic, items: rows.map(mapItem) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = topicSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "话题信息不正确。" }, { status: 400 });
  const db = getDb();
  if (!db.prepare("SELECT id FROM topics WHERE id = ?").get(id)) return NextResponse.json({ error: "没有找到这个话题。" }, { status: 404 });
  const key = topicNameKey(parsed.data.name);
  if (db.prepare("SELECT id FROM topics WHERE name_key = ? AND id != ?").get(key, id)) return NextResponse.json({ error: "已经有同名话题，请换一个名称。" }, { status: 409 });
  db.prepare("UPDATE topics SET name = ?, name_key = ?, description = ?, updated_at = ? WHERE id = ?")
    .run(parsed.data.name, key, parsed.data.description, new Date().toISOString(), id);
  return NextResponse.json({ topic: listTopics(db).find((topic) => topic.id === id), message: "话题已更新。" });
}
