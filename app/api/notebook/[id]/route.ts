import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, mapNotebookNote } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(300),
  content: z.string().trim().min(1).max(10_000)
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const parsed = noteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "笔记内容不正确。" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE notebook_notes
       SET title = ?, summary = ?, content = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(parsed.data.title, parsed.data.summary, parsed.data.content, now, id);
  if (!result.changes) {
    return NextResponse.json({ error: "没有找到这条笔记。" }, { status: 404 });
  }

  const row = db
    .prepare(
      `SELECT id, title, summary, content, source_item_title, provider, created_at
       FROM notebook_notes WHERE id = ?`
    )
    .get(id) as Record<string, string | number | null>;
  return NextResponse.json({ note: mapNotebookNote(row), message: "笔记已更新。" });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const db = getDb();
  const result = db.prepare("DELETE FROM notebook_notes WHERE id = ?").run(id);
  if (!result.changes) {
    return NextResponse.json({ error: "没有找到这条笔记。" }, { status: 404 });
  }
  return NextResponse.json({ message: "笔记已删除，原事项建议不受影响。" });
}
