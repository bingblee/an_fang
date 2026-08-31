import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Topic, TopicSource } from "@/lib/types";

export const topicSchema = z.object({
  name: z.string().trim().min(1, "请填写话题名称").max(80, "话题名称最多 80 个字"),
  description: z.string().trim().max(500, "描述最多 500 个字").default("")
});

export type TopicChoice = "auto" | "none" | string;
export type TopicContext = Pick<Topic, "id" | "name" | "description">;
export type TopicAssignment = { topicId: string | null; source: TopicSource };

export function topicNameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function listTopics(db: DatabaseSync): Topic[] {
  const rows = db.prepare(`
    SELECT t.*,
      COUNT(CASE WHEN i.status IN ('scheduled', 'waiting', 'later') THEN 1 END) AS open_count,
      COUNT(CASE WHEN i.status = 'completed' THEN 1 END) AS completed_count
    FROM topics t LEFT JOIN items i ON i.topic_id = t.id
    GROUP BY t.id ORDER BY t.created_at DESC, t.id
  `).all();
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name), description: String(row.description),
    openCount: Number(row.open_count), completedCount: Number(row.completed_count),
    createdAt: String(row.created_at)
  }));
}

export function createTopic(db: DatabaseSync, input: z.infer<typeof topicSchema>) {
  const parsed = topicSchema.parse(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  const key = topicNameKey(parsed.name);
  const result = db.prepare(`
    INSERT INTO topics (id, name, name_key, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name_key) DO NOTHING
  `).run(id, parsed.name, key, parsed.description, now, now);
  const existing = db.prepare("SELECT id FROM topics WHERE name_key = ?").get(key)!;
  return { topic: listTopics(db).find((topic) => topic.id === existing.id)!, created: Number(result.changes) > 0 };
}

// Only an explicit leading command creates a topic. Quoted conversations and ordinary tasks stay tasks.
export function parseTopicCommand(text: string): { name: string; remainingText: string } | null {
  const match = text.trim().match(
    /^(?:(?:请|麻烦)(?:帮我)?|帮我|我想(?:要)?|想要)?\s*(?:创建|新建|建立|开)\s*(?:一个|个)?\s*(?:关于)?\s*([^\n。！!？?；;]{1,100}?)\s*(?:的)?(?:话题|主题|专题)(?=$|[\s。！!；;，,：:])([\s\S]*)$/
  );
  if (!match) return null;
  const name = match[1].trim().replace(/的$/, "").replace(/^[“「『"']|[”」』"']$/g, "").trim();
  if (!name || name.length > 80) return null;
  return { name, remainingText: match[2].replace(/^[\s。！!；;，,：:]+/, "").trim() };
}

const normalizeText = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function matchTopicByName(text: string, topics: TopicContext[]): string | null {
  const content = normalizeText(text);
  const matches = topics.filter((topic) => {
    const name = normalizeText(topic.name);
    const shortName = name.replace(/(?:项目|话题|主题|专题)$/, "");
    return (name.length >= 2 && content.includes(name)) ||
      (shortName.length >= 2 && content.includes(shortName));
  });
  return matches.length === 1 ? matches[0].id : null;
}

export function topicContext(topics: Topic[], text: string, selectedId: string): TopicContext[] {
  const matchingId = matchTopicByName(text, topics);
  return [...topics].sort((a, b) =>
    Number(b.id === selectedId || b.id === matchingId) - Number(a.id === selectedId || a.id === matchingId)
  ).slice(0, 40).map(({ id, name, description }) => ({ id, name, description }));
}

export function resolveTopicAssignment(input: {
  choice: TopicChoice;
  topics: TopicContext[];
  text: string;
  aiTopicId: string | null;
  aiConfidence: number;
  existing?: { topicId: string | null; source: TopicSource };
}): TopicAssignment {
  if (input.choice === "none") return { topicId: null, source: "manual" };
  if (input.choice !== "auto") return { topicId: input.choice, source: "manual" };
  // A supplement never silently moves an existing task, including a user's explicit "unassigned" choice.
  if (input.existing?.topicId || input.existing?.source === "manual") return input.existing;
  if (input.aiConfidence >= 0.8 && input.topics.some((topic) => topic.id === input.aiTopicId)) {
    return { topicId: input.aiTopicId, source: "ai" };
  }
  const matched = matchTopicByName(input.text, input.topics);
  return { topicId: matched, source: matched ? "rule" : null };
}

export function canMergeIntoTopic(existingTopicId: string | null, choice: TopicChoice, inferredTopicId: string | null) {
  if (choice === "none") return existingTopicId === null;
  const target = choice === "auto" ? inferredTopicId : choice;
  return !target || !existingTopicId || existingTopicId === target;
}
