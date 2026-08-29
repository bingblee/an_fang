import type { DatabaseSync } from "node:sqlite";
import type { MergeCandidate } from "@/lib/types";

type CandidateRow = {
  id: string;
  title: string;
  notes: string | null;
  category: MergeCandidate["category"];
  status: MergeCandidate["status"];
  scheduled_for: string | null;
  time_window: string | null;
  person: string | null;
  context_label: string | null;
  source_excerpt: string | null;
  updated_at: string;
};

const topicWords = [
  "高铁",
  "火车",
  "飞机",
  "航班",
  "酒店",
  "出差",
  "旅行",
  "披萨",
  "材料",
  "会议",
  "方案",
  "项目",
  "客户",
  "快递",
  "报销",
  "体检",
  "医生",
  "药",
  "购物",
  "采购",
  "聚餐",
  "电影",
  "课程",
  "续费",
  "缴费",
  "水电费"
];

const stopBigrams = new Set([
  "今天",
  "下午",
  "上午",
  "晚上",
  "明天",
  "时间",
  "这个",
  "那个",
  "一下",
  "需要",
  "帮我",
  "记得",
  "事情",
  "任务",
  "里面"
]);

function tokens(input: string) {
  const normalized = input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\s，。！？、；：,.!?;:（）()\[\]【】“”'"-]+/g, " ");
  const result = new Set<string>();

  for (const word of topicWords) {
    if (normalized.includes(word)) result.add(word);
  }
  for (const token of normalized.match(/[a-z0-9]{2,}/g) || []) result.add(token);
  for (const chunk of normalized.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    for (let index = 0; index < chunk.length - 1; index += 1) {
      const bigram = chunk.slice(index, index + 2);
      if (!stopBigrams.has(bigram)) result.add(bigram);
    }
  }
  return result;
}

function scoreCandidate(input: string, row: CandidateRow) {
  const inputTokens = tokens(input);
  const candidateTokens = tokens(
    `${row.title} ${row.notes || ""} ${row.source_excerpt || ""} ${row.person || ""}`
  );
  const overlap = [...inputTokens].filter((token) => candidateTokens.has(token));
  const union = new Set([...inputTokens, ...candidateTokens]);
  const semanticScore = overlap.length * 0.22 + (union.size ? overlap.length / union.size : 0);
  const continuation = /(?:时间是|改成|更新|补充|刚才|之前|那个|这件事|备注|放到|加到|就是)/.test(
    input
  )
    ? 0.18
    : 0;
  const ageHours = (Date.now() - new Date(row.updated_at).getTime()) / 3_600_000;
  const recency = ageHours <= 6 ? 0.08 : ageHours <= 48 ? 0.04 : 0;
  return Math.min(1, semanticScore + continuation + recency);
}

export function findMergeCandidates(db: DatabaseSync, input: string, hasImage = false) {
  const explicitReference =
    /(?:怎么做|做法|方法|攻略|给.*建议|查找|查询|搜一下|清单|步骤|教程|备注在|附在|放到.*(?:事项|任务))/i.test(
      input
    );
  const lookbackDays = explicitReference ? 180 : 14;
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT id, title, notes, category, status, scheduled_for, time_window,
              person, context_label, source_excerpt, updated_at
       FROM items
       WHERE status IN ('scheduled', 'waiting', 'later')
         AND updated_at >= ?
       ORDER BY updated_at DESC
       LIMIT ${explicitReference ? 80 : 30}`
    )
    .all(cutoff) as unknown as CandidateRow[];

  return rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes,
      category: row.category,
      status: row.status,
      scheduledFor: row.scheduled_for,
      timeWindow: row.time_window,
      person: row.person,
      contextLabel: row.context_label,
      sourceExcerpt: row.source_excerpt,
      updatedAt: row.updated_at,
      matchScore: hasImage && !input ? 0.1 : scoreCandidate(input, row)
    }))
    .filter((candidate) => candidate.matchScore >= 0.12)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
}
