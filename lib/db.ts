import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Item, ItemEnrichment, NotebookNote } from "@/lib/types";
import { ensureDataDirectory, getRuntimeConfig } from "@/lib/runtime-config.mjs";

const runtimeConfig = getRuntimeConfig(process.env, /* turbopackIgnore: true */ process.cwd());
export const dataDir = runtimeConfig.dataDir;
export const uploadsDir = join(dataDir, "uploads");

declare global {
  var __anfangDb: DatabaseSync | undefined;
}

function initialize(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      original_text TEXT,
      source_url TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      storage_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_extractions (
      id TEXT PRIMARY KEY,
      capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT NOT NULL,
      result_json TEXT,
      confidence REAL,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      notes TEXT,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      duration_minutes INTEGER,
      energy TEXT NOT NULL,
      person TEXT,
      context_label TEXT,
      scheduled_for TEXT,
      time_window TEXT,
      source_excerpt TEXT,
      extraction_source TEXT NOT NULL,
      confidence REAL NOT NULL,
      needs_confirmation INTEGER NOT NULL DEFAULT 0,
      confirmation_question TEXT,
      merged_into_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_status_schedule
      ON items(status, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_items_capture ON items(capture_id);

    CREATE TABLE IF NOT EXISTS item_sources (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      relation TEXT NOT NULL DEFAULT 'primary',
      created_at TEXT NOT NULL,
      PRIMARY KEY (item_id, capture_id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_sources_capture
      ON item_sources(capture_id);

    CREATE TABLE IF NOT EXISTS item_enrichments (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      content TEXT,
      request TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL,
      model TEXT,
      confidence REAL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_item_enrichments_item
      ON item_enrichments(item_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS notebook_notes (
      id TEXT PRIMARY KEY,
      source_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
      source_enrichment_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      source_item_title TEXT,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notebook_notes_created
      ON notebook_notes(created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_notebook_notes_source_enrichment
      ON notebook_notes(source_enrichment_id)
      WHERE source_enrichment_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      value TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      reason TEXT,
      scheduled_for TEXT NOT NULL,
      delivered_at TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      original_value TEXT,
      corrected_value TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_facts (
      id TEXT PRIMARY KEY,
      fact_type TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      confirmed INTEGER NOT NULL DEFAULT 0,
      sensitivity TEXT NOT NULL DEFAULT 'normal',
      valid_from TEXT,
      valid_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      session_token_hash TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
      ON auth_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      attempt_key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const itemColumns = db.prepare("PRAGMA table_info(items)").all() as Array<{
    name: string;
  }>;
  if (!itemColumns.some((column) => column.name === "merged_into_id")) {
    db.exec("ALTER TABLE items ADD COLUMN merged_into_id TEXT");
  }
  if (!itemColumns.some((column) => column.name === "topic_id")) {
    db.exec("ALTER TABLE items ADD COLUMN topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL");
  }
  if (!itemColumns.some((column) => column.name === "topic_source")) {
    db.exec("ALTER TABLE items ADD COLUMN topic_source TEXT");
  }
  if (!itemColumns.some((column) => column.name === "category_manual")) {
    db.exec("ALTER TABLE items ADD COLUMN category_manual INTEGER NOT NULL DEFAULT 0");
  }
  if (!itemColumns.some((column) => column.name === "review_at")) {
    db.exec("ALTER TABLE items ADD COLUMN review_at TEXT");
  }
  if (!itemColumns.some((column) => column.name === "review_interval_days")) {
    db.exec("ALTER TABLE items ADD COLUMN review_interval_days INTEGER");
  }
  const pushColumns = db.prepare("PRAGMA table_info(push_subscriptions)").all() as Array<{ name: string }>;
  if (!pushColumns.some((column) => column.name === "session_token_hash")) {
    db.exec("ALTER TABLE push_subscriptions ADD COLUMN session_token_hash TEXT");
  }
  db.exec(`WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS position
      FROM items WHERE status = 'later' AND review_at IS NULL
    )
    UPDATE items SET
      review_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || (((SELECT position FROM ranked WHERE ranked.id = items.id) - 1) % 3) || ' days'),
      review_interval_days = 3
    WHERE id IN (SELECT id FROM ranked)`);
  db.exec(`UPDATE triggers
    SET value = (SELECT review_at FROM items WHERE items.id = triggers.item_id)
    WHERE type = 'review' AND active = 1 AND (value IS NULL OR value = 'daily')
      AND EXISTS (
        SELECT 1 FROM items
        WHERE items.id = triggers.item_id AND items.status = 'later' AND items.review_at IS NOT NULL
      )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_items_topic_status ON items(topic_id, status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_items_category_status ON items(category, status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_items_review_at ON items(status, review_at)");
  db.exec(`
    INSERT OR IGNORE INTO item_sources (item_id, capture_id, relation, created_at)
    SELECT id, capture_id, 'primary', created_at FROM items;

    UPDATE item_enrichments
    SET status = 'ready'
    WHERE status = 'notebook';
  `);
}

export function getDb() {
  if (!globalThis.__anfangDb) {
    ensureDataDirectory(runtimeConfig);
    const db = new DatabaseSync(join(dataDir, "app.db"));
    initialize(db);
    globalThis.__anfangDb = db;
  }
  return globalThis.__anfangDb;
}

type ItemRow = Record<string, string | number | null>;

export function mapNotebookNote(row: ItemRow): NotebookNote {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: String(row.summary),
    content: String(row.content),
    sourceItemTitle: row.source_item_title ? String(row.source_item_title) : null,
    provider: String(row.provider) as NotebookNote["provider"],
    createdAt: String(row.created_at)
  };
}

export function mapItem(row: ItemRow): Item {
  return {
    id: String(row.id),
    topicId: row.topic_id ? String(row.topic_id) : null,
    topicName: row.topic_name ? String(row.topic_name) : null,
    topicSource: row.topic_source ? String(row.topic_source) as Item["topicSource"] : null,
    captureId: String(row.capture_id),
    title: String(row.title),
    notes: row.notes ? String(row.notes) : null,
    category: String(row.category) as Item["category"],
    categoryManual: Boolean(row.category_manual),
    status: String(row.status) as Item["status"],
    priority: String(row.priority) as Item["priority"],
    durationMinutes:
      typeof row.duration_minutes === "number" ? row.duration_minutes : null,
    energy: String(row.energy) as Item["energy"],
    person: row.person ? String(row.person) : null,
    contextLabel: row.context_label ? String(row.context_label) : null,
    scheduledFor: row.scheduled_for ? String(row.scheduled_for) : null,
    reviewAt: row.review_at ? String(row.review_at) : null,
    reviewIntervalDays: typeof row.review_interval_days === "number" ? row.review_interval_days : null,
    timeWindow: row.time_window ? String(row.time_window) : null,
    sourceExcerpt: row.source_excerpt ? String(row.source_excerpt) : null,
    extractionSource: String(row.extraction_source) as Item["extractionSource"],
    confidence: Number(row.confidence),
    needsConfirmation: Boolean(row.needs_confirmation),
    confirmationQuestion: row.confirmation_question
      ? String(row.confirmation_question)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    sourceCount: Number(row.source_count || 1),
    enrichmentCount: Number(row.enrichment_count || 0),
    enrichment: row.enrichment_id
      ? {
          id: String(row.enrichment_id),
          kind: String(row.enrichment_kind) as ItemEnrichment["kind"],
          title: String(row.enrichment_title || "一条实用建议"),
          summary: String(row.enrichment_summary || ""),
          content: String(row.enrichment_content || ""),
          request: row.enrichment_request ? String(row.enrichment_request) : null,
          provider: String(row.enrichment_provider) as "deepseek" | "local",
          createdAt: String(row.enrichment_created_at)
        }
      : null,
    attachment: row.attachment_id
      ? {
          id: String(row.attachment_id),
          mimeType: String(row.mime_type),
          originalName: String(row.original_name)
        }
      : null
  };
}

export const itemSelect = `
  SELECT i.*, topic.name AS topic_name,
         (SELECT COUNT(*) FROM item_sources source_count
          WHERE source_count.item_id = i.id) AS source_count,
         (SELECT COUNT(*) FROM item_enrichments enrichment_count
          WHERE enrichment_count.item_id = i.id
            AND enrichment_count.status = 'ready') AS enrichment_count,
         enrichment.id AS enrichment_id,
         enrichment.kind AS enrichment_kind,
         enrichment.title AS enrichment_title,
         enrichment.summary AS enrichment_summary,
         enrichment.content AS enrichment_content,
         enrichment.request AS enrichment_request,
         enrichment.provider AS enrichment_provider,
         enrichment.created_at AS enrichment_created_at,
         a.id AS attachment_id,
         a.mime_type,
         a.original_name
  FROM items i
  LEFT JOIN topics topic ON topic.id = i.topic_id
  LEFT JOIN item_enrichments enrichment ON enrichment.id = (
    SELECT latest_enrichment.id
    FROM item_enrichments latest_enrichment
    WHERE latest_enrichment.item_id = i.id
      AND latest_enrichment.status = 'ready'
    ORDER BY latest_enrichment.created_at DESC
    LIMIT 1
  )
  LEFT JOIN attachments a ON a.id = (
    SELECT source_attachment.id
    FROM item_sources source_link
    JOIN attachments source_attachment
      ON source_attachment.capture_id = source_link.capture_id
    WHERE source_link.item_id = i.id
    ORDER BY source_attachment.created_at DESC
    LIMIT 1
  )
`;
