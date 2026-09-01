import type { DatabaseSync } from "node:sqlite";
import { categoryDescriptions, categoryIds, categoryLabels } from "@/lib/category-definitions";
import type { CategorySummary } from "@/lib/types";

export function listCategories(db: DatabaseSync): CategorySummary[] {
  const rows = db.prepare(`SELECT category,
    COUNT(CASE WHEN status IN ('scheduled', 'doing', 'waiting', 'later') THEN 1 END) AS open_count,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed_count
    FROM items GROUP BY category`).all();
  return categoryIds.map((id) => {
    const row = rows.find((entry) => entry.category === id);
    return { id, name: categoryLabels[id], description: categoryDescriptions[id],
      openCount: Number(row?.open_count || 0), completedCount: Number(row?.completed_count || 0) };
  });
}
