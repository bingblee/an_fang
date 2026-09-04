import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, itemSelect, mapItem } from "@/lib/db";
import { createItemEnrichment } from "@/lib/enrichment";
import { requireApiSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  request: z.string().trim().min(1).max(500).optional()
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  const { userId } = auth.session;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "建议要求不正确。" }, { status: 400 });
  }

  const db = getDb();
  const item = db
    .prepare(
      `SELECT id, title FROM items
       WHERE id = ? AND user_id = ? AND status IN ('scheduled', 'doing', 'waiting', 'later')`
    )
    .get(id, userId) as { id: string; title: string } | undefined;
  if (!item) {
    return NextResponse.json({ error: "没有找到这件事。" }, { status: 404 });
  }

  const enrichment = await createItemEnrichment({
    db,
    userId,
    itemId: id,
    request: parsed.data.request,
    kind: "requested"
  });
  if (enrichment.error) {
    return NextResponse.json(
      { error: "建议暂时没有生成，请稍后再试。" },
      { status: 502 }
    );
  }

  const row = db.prepare(`${itemSelect} WHERE i.id = ? AND i.user_id = ?`).get(id, userId) as Record<
    string,
    string | number | null
  >;
  return NextResponse.json({
    item: mapItem(row),
    message: `已把建议附到：${item.title}`,
    usedAI: enrichment.provider === "deepseek"
  });
}
