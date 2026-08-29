import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb, itemSelect, mapItem, uploadsDir } from "@/lib/db";
import { resolveSchedule } from "@/lib/date";
import { createItemEnrichment } from "@/lib/enrichment";
import { extractCapture } from "@/lib/extraction";
import { findMergeCandidates } from "@/lib/merge-candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);

function extensionFor(file: File) {
  const existing = extname(file.name).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(existing)) {
    return existing === ".jpeg" ? ".jpg" : existing;
  }
  return file.type === "image/png"
    ? ".png"
    : file.type === "image/gif"
      ? ".gif"
      : file.type === "image/webp"
        ? ".webp"
        : ".jpg";
}

function combineText(existing: unknown, next: string | null, raw: string) {
  const current = typeof existing === "string" ? existing.trim() : "";
  const addition = (next || raw).trim();
  if (!current) return addition || null;
  if (!addition || current.includes(addition)) return current;
  if (addition.includes(current)) return addition;
  return `${current}\n补充：${addition}`;
}

function addTrigger(
  db: ReturnType<typeof getDb>,
  itemId: string,
  schedule: { status: "scheduled" | "waiting" | "later"; scheduledFor: string | null },
  contextLabel: string | null,
  createdAt: string
) {
  if (schedule.scheduledFor) {
    db.prepare(
      `INSERT INTO triggers (id, item_id, type, value, active, created_at)
       VALUES (?, ?, 'time', ?, 1, ?)`
    ).run(randomUUID(), itemId, schedule.scheduledFor, createdAt);
  } else if (contextLabel) {
    db.prepare(
      `INSERT INTO triggers (id, item_id, type, value, active, created_at)
       VALUES (?, ?, 'context', ?, 1, ?)`
    ).run(randomUUID(), itemId, contextLabel, createdAt);
  } else {
    db.prepare(
      `INSERT INTO triggers (id, item_id, type, value, active, created_at)
       VALUES (?, ?, 'review', 'daily', 1, ?)`
    ).run(randomUUID(), itemId, createdAt);
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const text = String(formData.get("text") || "").trim();
  const attachmentValue = formData.get("attachment");
  const attachment = attachmentValue instanceof File ? attachmentValue : null;

  if (!text && !attachment) {
    return NextResponse.json({ error: "请先写下一件事或添加一张截图。" }, { status: 400 });
  }
  if (attachment && !allowedImageTypes.has(attachment.type)) {
    return NextResponse.json(
      { error: "MVP 暂时支持 JPG、PNG、GIF 和 WebP 图片。" },
      { status: 415 }
    );
  }
  if (attachment && attachment.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "图片不能超过 8MB。" }, { status: 413 });
  }

  const db = getDb();
  const captureId = randomUUID();
  const createdAt = new Date().toISOString();
  const sourceUrl = text.match(/https?:\/\/[^\s]+/i)?.[0] || null;
  const kind = attachment ? (text ? "mixed" : "image") : sourceUrl ? "link" : "text";

  db.prepare(
    `INSERT INTO captures
      (id, kind, original_text, source_url, status, created_at)
     VALUES (?, ?, ?, ?, 'processing', ?)`
  ).run(captureId, kind, text || null, sourceUrl, createdAt);

  let attachmentRecord:
    | { id: string; mimeType: string; originalName: string; base64: string }
    | undefined;

  try {
    if (attachment) {
      const bytes = Buffer.from(await attachment.arrayBuffer());
      const date = new Date();
      const folder = join(
        uploadsDir,
        String(date.getFullYear()),
        String(date.getMonth() + 1).padStart(2, "0")
      );
      await mkdir(folder, { recursive: true });
      const attachmentId = randomUUID();
      const filePath = join(folder, `${attachmentId}${extensionFor(attachment)}`);
      await writeFile(filePath, bytes, { flag: "wx" });
      db.prepare(
        `INSERT INTO attachments
          (id, capture_id, storage_path, original_name, mime_type, size, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        attachmentId,
        captureId,
        filePath,
        attachment.name || `截图${extensionFor(attachment)}`,
        attachment.type,
        bytes.length,
        createHash("sha256").update(bytes).digest("hex"),
        createdAt
      );
      attachmentRecord = {
        id: attachmentId,
        mimeType: attachment.type,
        originalName: attachment.name,
        base64: bytes.toString("base64")
      };
    }

    const candidates = findMergeCandidates(db, text, Boolean(attachmentRecord));
    const extraction = await extractCapture(
      text,
      attachmentRecord
        ? { mimeType: attachmentRecord.mimeType, base64: attachmentRecord.base64 }
        : undefined,
      candidates
    );
    const extracted = extraction.item;
    const schedule = resolveSchedule(extracted);
    const itemId = randomUUID();
    const extractionId = randomUUID();

    db.prepare(
      `INSERT INTO ai_extractions
        (id, capture_id, provider, model, prompt_version, result_json, confidence, error, created_at)
       VALUES (?, ?, ?, ?, 'capture-v3-enrichment', ?, ?, ?, ?)`
    ).run(
      extractionId,
      captureId,
      extraction.provider,
      extraction.model,
      JSON.stringify({
        item: extracted,
        operation: extraction.operation,
        mergeTargetId: extraction.mergeTargetId,
        mergeConfidence: extraction.mergeConfidence,
        mergeReason: extraction.mergeReason,
        enrichmentNeeded: extraction.enrichmentNeeded,
        enrichmentRequest: extraction.enrichmentRequest,
        enrichmentConfidence: extraction.enrichmentConfidence
      }),
      extracted.confidence,
      extraction.error || null,
      new Date().toISOString()
    );

    const targetConfidence =
      extraction.operation === "enrich"
        ? Math.max(extraction.mergeConfidence, extraction.enrichmentConfidence)
        : extraction.mergeConfidence;
    const existingTarget =
      extraction.operation !== "create" &&
      extraction.mergeTargetId &&
      targetConfidence >= 0.72
        ? (db
            .prepare(
              `SELECT * FROM items
               WHERE id = ? AND status IN ('scheduled', 'waiting', 'later')`
            )
            .get(extraction.mergeTargetId) as Record<string, string | number | null> | undefined)
        : undefined;

    const sourceText = text.slice(0, 280) || (attachment ? "来自截图" : "");
    let resultItemId: string = itemId;
    let merged = false;
    let enriched = false;
    let enrichmentProvider: "deepseek" | "local" | null = null;
    let enrichmentError: string | null = null;

    if (existingTarget && extraction.operation === "enrich") {
      resultItemId = String(existingTarget.id);
      enriched = true;
      db.prepare(
        `INSERT OR IGNORE INTO item_sources
          (item_id, capture_id, relation, created_at)
         VALUES (?, ?, 'enrichment_request', ?)`
      ).run(resultItemId, captureId, createdAt);
      db.prepare("UPDATE items SET updated_at = ? WHERE id = ?").run(createdAt, resultItemId);
      const enrichment = await createItemEnrichment({
        db,
        itemId: resultItemId,
        captureId,
        request: extraction.enrichmentRequest || text,
        kind: "requested"
      });
      enrichmentProvider = enrichment.provider;
      enrichmentError = enrichment.error;
    } else if (existingTarget && extraction.operation === "merge") {
      resultItemId = String(existingTarget.id);
      merged = true;
      const hasScheduleUpdate =
        Boolean(extracted.specificTime) || extracted.scheduleHint !== "none";
      const nextStatus = hasScheduleUpdate ? schedule.status : String(existingTarget.status);
      const nextScheduledFor = hasScheduleUpdate
        ? schedule.scheduledFor
        : existingTarget.scheduled_for;
      const nextNotes = combineText(existingTarget.notes, extracted.notes, text);
      const nextSourceExcerpt = combineText(
        existingTarget.source_excerpt,
        sourceText,
        sourceText
      );

      db.prepare(
        `UPDATE items SET
          title = ?, notes = ?, category = ?, status = ?, priority = ?,
          duration_minutes = ?, energy = ?, person = ?, context_label = ?,
          scheduled_for = ?, time_window = ?, source_excerpt = ?,
          extraction_source = ?, confidence = ?, needs_confirmation = ?,
          confirmation_question = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        extracted.title,
        nextNotes,
        extracted.category,
        nextStatus,
        extracted.priority,
        extracted.durationMinutes ?? existingTarget.duration_minutes,
        extracted.energy,
        extracted.person ?? existingTarget.person,
        extracted.contextLabel ?? existingTarget.context_label,
        nextScheduledFor,
        extracted.timeWindow ?? existingTarget.time_window,
        nextSourceExcerpt,
        extraction.provider,
        extracted.confidence,
        extracted.needsConfirmation ? 1 : 0,
        extracted.confirmationQuestion,
        createdAt,
        resultItemId
      );
      db.prepare(
        `INSERT OR IGNORE INTO item_sources
          (item_id, capture_id, relation, created_at)
         VALUES (?, ?, 'supplement', ?)`
      ).run(resultItemId, captureId, createdAt);

      if (hasScheduleUpdate) {
        db.prepare("UPDATE triggers SET active = 0 WHERE item_id = ?").run(resultItemId);
        addTrigger(
          db,
          resultItemId,
          {
            status: nextStatus as "scheduled" | "waiting" | "later",
            scheduledFor: nextScheduledFor as string | null
          },
          extracted.contextLabel ?? (existingTarget.context_label as string | null),
          createdAt
        );
      }
    } else {
      db.prepare(
        `INSERT INTO items
          (id, capture_id, title, notes, category, status, priority,
           duration_minutes, energy, person, context_label, scheduled_for,
           time_window, source_excerpt, extraction_source, confidence,
           needs_confirmation, confirmation_question, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId,
        captureId,
        extracted.title,
        extracted.notes,
        extracted.category,
        schedule.status,
        extracted.priority,
        extracted.durationMinutes,
        extracted.energy,
        extracted.person,
        extracted.contextLabel,
        schedule.scheduledFor,
        extracted.timeWindow,
        sourceText || null,
        extraction.provider,
        extracted.confidence,
        extracted.needsConfirmation ? 1 : 0,
        extracted.confirmationQuestion,
        createdAt,
        createdAt
      );
      db.prepare(
        `INSERT INTO item_sources (item_id, capture_id, relation, created_at)
         VALUES (?, ?, 'primary', ?)`
      ).run(itemId, captureId, createdAt);
      addTrigger(db, itemId, schedule, extracted.contextLabel, createdAt);
    }

    if (
      !enriched &&
      extraction.enrichmentNeeded &&
      extraction.enrichmentConfidence >= 0.68
    ) {
      const enrichment = await createItemEnrichment({
        db,
        itemId: resultItemId,
        captureId,
        request: extraction.enrichmentRequest,
        kind: "proactive",
        skipIfReady: true
      });
      if (enrichment.created) enriched = true;
      enrichmentProvider = enrichment.provider;
      enrichmentError = enrichment.error;
    }

    db.prepare(
      "UPDATE captures SET status = 'processed', processed_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), captureId);

    const row = db.prepare(`${itemSelect} WHERE i.id = ?`).get(resultItemId) as Record<
      string,
      string | number | null
    >;
    const resultItem = mapItem(row);
    const message =
      extraction.operation === "enrich" && existingTarget
        ? enrichmentError
          ? `已把请求附到：${resultItem.title}，建议稍后再生成`
          : `已把建议附到：${resultItem.title}`
        : merged
          ? `已补充到：${resultItem.title}`
          : enriched
            ? `已安放并附上一条建议：${resultItem.title}`
            : `已安放：${resultItem.title}`;
    return NextResponse.json({
      item: resultItem,
      message,
      usedAI: extraction.provider === "deepseek" || enrichmentProvider === "deepseek",
      merged,
      enriched,
      mergeReason: merged ? extraction.mergeReason : null,
      fallbackReason: extraction.error || enrichmentError || null
    });
  } catch (error) {
    db.prepare("UPDATE captures SET status = 'failed' WHERE id = ?").run(captureId);
    return NextResponse.json(
      {
        error: "内容已经保存，但整理时遇到问题。你可以稍后在收件箱继续处理。",
        detail: error instanceof Error ? error.message : "未知错误"
      },
      { status: 500 }
    );
  }
}
