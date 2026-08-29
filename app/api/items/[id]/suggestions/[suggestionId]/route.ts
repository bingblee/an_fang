import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.literal("save_to_notebook")
});

type EnrichmentRow = {
  id: string;
  item_id: string;
  title: string;
  summary: string;
  content: string;
  provider: string;
  item_title: string;
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; suggestionId: string }> }
) {
  const { id, suggestionId } = await context.params;
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "操作参数不正确。" }, { status: 400 });
  }

  const db = getDb();
  const suggestion = db
    .prepare(
      `SELECT enrichment.id, enrichment.item_id, enrichment.title,
              enrichment.summary, enrichment.content, enrichment.provider,
              item.title AS item_title
       FROM item_enrichments enrichment
       JOIN items item ON item.id = enrichment.item_id
       WHERE enrichment.id = ? AND enrichment.item_id = ?
         AND enrichment.status = 'ready'`
    )
    .get(suggestionId, id) as EnrichmentRow | undefined;
  if (!suggestion) {
    return NextResponse.json({ error: "没有找到这条建议。" }, { status: 404 });
  }

  const existingNote = db
    .prepare("SELECT id FROM notebook_notes WHERE source_enrichment_id = ?")
    .get(suggestionId) as { id: string } | undefined;
  if (existingNote) {
    return NextResponse.json({
      message: "笔记本中已有副本，事项里的建议仍然保留。",
      noteId: existingNote.id,
      alreadySaved: true
    });
  }

  const noteId = randomUUID();
  const now = new Date().toISOString();
  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    db.prepare(
      `INSERT INTO notebook_notes
        (id, source_item_id, source_enrichment_id, title, summary, content,
         source_item_title, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      noteId,
      suggestion.item_id,
      suggestion.id,
      suggestion.title,
      suggestion.summary,
      suggestion.content,
      suggestion.item_title,
      suggestion.provider,
      now,
      now
    );
    db.prepare(
      `INSERT INTO feedback
        (id, item_id, kind, corrected_value, created_at)
       VALUES (?, ?, 'suggestion_copied_to_notebook', ?, ?)`
    ).run(randomUUID(), id, noteId, now);
    db.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK");
    throw error;
  }

  return NextResponse.json({
    message: "已复制到笔记本，事项里的建议仍然保留。",
    noteId,
    alreadySaved: false
  });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; suggestionId: string }> }
) {
  const { id, suggestionId } = await context.params;
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `DELETE FROM item_enrichments
       WHERE id = ? AND item_id = ? AND status = 'ready'`
    )
    .run(suggestionId, id);
  if (!result.changes) {
    return NextResponse.json({ error: "没有找到这条建议。" }, { status: 404 });
  }
  db.prepare(
    `INSERT INTO feedback
      (id, item_id, kind, corrected_value, created_at)
     VALUES (?, ?, 'suggestion_deleted', ?, ?)`
  ).run(randomUUID(), id, suggestionId, now);
  return NextResponse.json({ message: "建议便笺已删除。" });
}
