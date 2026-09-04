import { NextRequest, NextResponse } from "next/server";
import { getDb, itemSelect, mapItem } from "@/lib/db";
import { listCategories } from "@/lib/categories";
import { categoryIds } from "@/lib/category-definitions";
import { requireApiSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession(request);
  if (!auth.ok) return auth.response;
  const { userId } = auth.session;
  const { id } = await context.params;
  if (!categoryIds.some((category) => category === id)) {
    return NextResponse.json({ error: "没有找到这个分类。" }, { status: 404 });
  }
  const db = getDb();
  const category = listCategories(db, userId).find((entry) => entry.id === id)!;
  const rows = db.prepare(`${itemSelect} WHERE i.user_id = ? AND i.category = ? AND i.status NOT IN ('merged', 'abandoned')
    ORDER BY CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END,
      CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
      COALESCE(i.scheduled_for, '9999'), i.created_at DESC, i.id`).all(userId, id) as Record<string, string | number | null>[];
  return NextResponse.json({ category, items: rows.map(mapItem) }, { headers: { "Cache-Control": "no-store" } });
}
