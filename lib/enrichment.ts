import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ItemEnrichment } from "@/lib/types";

const enrichmentSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(180),
  content: z.string().min(1).max(5000),
  confidence: z.number().min(0).max(1).default(0.75)
});

type EnrichmentKind = ItemEnrichment["kind"];

type EnrichmentInput = {
  db: DatabaseSync;
  userId: string;
  itemId: string;
  captureId?: string | null;
  request?: string | null;
  kind: EnrichmentKind;
  skipIfReady?: boolean;
};

type ItemContext = {
  title: string;
  notes: string | null;
  category: string;
  scheduled_for: string | null;
  time_window: string | null;
  source_excerpt: string | null;
};

function defaultRequest(item: ItemContext) {
  if (/披萨|pizza/i.test(`${item.title} ${item.notes || ""}`)) {
    return "给出适合家庭制作的简易披萨方法，并整理购买材料清单";
  }
  return "给出一条能明显降低执行成本的实用建议、步骤或检查清单";
}

function normalizeSuggestionText(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

function localEnrichment(item: ItemContext, request: string) {
  const context = `${item.title} ${item.notes || ""} ${request}`;
  if (/披萨|pizza/i.test(context)) {
    return {
      title: "家庭披萨简易做法",
      summary: "先买齐饼底、酱料、芝士和喜欢的配料；用高温、短时间烤制。",
      content: `购买清单
• 披萨饼底 1 个（也可以用吐司、手抓饼代替）
• 披萨酱或番茄酱
• 马苏里拉芝士 150–200 克
• 洋葱、彩椒、蘑菇等蔬菜
• 火腿、培根、鸡肉或其他喜欢的配料

制作步骤
1. 烤箱提前预热到 220℃。
2. 饼底薄涂酱料，先铺一层芝士，再放切薄并沥干水分的配料。
3. 最上面再撒少量芝士，放入烤箱中层烤约 10–15 分钟。
4. 看到芝士融化并微微上色即可取出，静置 2 分钟后切开。

小提醒：蔬菜和肉类不要铺得太厚；生肉先做熟，能避免饼底烤焦但馅料还没熟。`,
      confidence: 0.72
    };
  }

  return {
    title: "开始前的小清单",
    summary: "把下一步缩小到一个可以立刻执行的动作，并提前准备所需信息。",
    content: `1. 先确认完成这件事需要什么结果。
2. 把下一步写成一个 10 分钟内可以开始的动作。
3. 提前放好需要的材料、链接或联系人信息。
4. 如果仍不能开始，补充一个明确的等待条件或提醒时间。`,
    confidence: 0.55
  };
}

async function deepSeekEnrichment(item: ItemContext, request: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { ...localEnrichment(item, request), provider: "local" as const, model: null };

  const model = process.env.DEEPSEEK_TEXT_MODEL || "deepseek-v4-flash";
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(
    /\/$/,
    ""
  );
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `你是一个克制、实用的个人生活助理。你的回答会作为“建议便笺”附在一条已有事项下面，而不是创建新待办。
只输出合法 JSON，不要输出 Markdown 代码块。建议必须直接帮助用户完成当前事项，使用简洁中文和可执行步骤。
如果是做饭或采购，优先给出材料清单、简短步骤、时间和关键避坑点；如果信息不足，采用安全、常见、容易调整的方案。
不要虚构已经联网搜索、实测或引用了来源，不要编造链接。医疗、法律、财务等高风险事项只给安全边界和寻求专业帮助的建议。
避免空泛鼓励，也不要额外制造一串新任务。content 可以使用换行和项目符号。
JSON 字段：title、summary、content、confidence。`
        },
        {
          role: "user",
          content: JSON.stringify({
            item: {
              title: item.title,
              notes: item.notes,
              category: item.category,
              scheduledFor: item.scheduled_for,
              timeWindow: item.time_window,
              sourceExcerpt: item.source_excerpt
            },
            request
          })
        }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      temperature: 0.35,
      max_tokens: 1500,
      stream: false
    }),
    signal: AbortSignal.timeout(35_000)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`DeepSeek ${response.status}: ${message.slice(0, 240)}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("DeepSeek 返回了空建议");
  const parsed = enrichmentSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`DeepSeek 建议格式校验失败: ${parsed.error.message.slice(0, 240)}`);
  }
  return { ...parsed.data, provider: "deepseek" as const, model };
}

export async function createItemEnrichment(input: EnrichmentInput) {
  const existing = input.skipIfReady
    ? (input.db
        .prepare(
          `SELECT id FROM item_enrichments
           WHERE item_id = ? AND status = 'ready'
             AND EXISTS (SELECT 1 FROM items WHERE id = item_enrichments.item_id AND user_id = ?)
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(input.itemId, input.userId) as { id: string } | undefined)
    : undefined;
  if (existing) {
    return { created: false, provider: null, error: null };
  }

  const item = input.db
    .prepare(
      `SELECT title, notes, category, scheduled_for, time_window, source_excerpt
       FROM items WHERE id = ? AND user_id = ?`
    )
    .get(input.itemId, input.userId) as ItemContext | undefined;
  if (!item) throw new Error("没有找到需要建议的事项");

  const request = (input.request || defaultRequest(item)).trim().slice(0, 500);
  const id = randomUUID();
  const now = new Date().toISOString();
  input.db
    .prepare(
      `INSERT INTO item_enrichments
        (id, item_id, capture_id, kind, request, status, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 'local', ?, ?)`
    )
    .run(id, input.itemId, input.captureId || null, input.kind, request, now, now);

  try {
    let generated;
    try {
      generated = await deepSeekEnrichment(item, request);
    } catch (error) {
      generated = {
        ...localEnrichment(item, request),
        provider: "local" as const,
        model: null,
        fallbackError: error instanceof Error ? error.message : "DeepSeek 建议生成失败"
      };
    }
    input.db
      .prepare(
        `UPDATE item_enrichments SET
          title = ?, summary = ?, content = ?, status = 'ready', provider = ?,
          model = ?, confidence = ?, error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        normalizeSuggestionText(generated.title),
        normalizeSuggestionText(generated.summary),
        normalizeSuggestionText(generated.content),
        generated.provider,
        generated.model,
        generated.confidence,
        "fallbackError" in generated ? generated.fallbackError : null,
        new Date().toISOString(),
        id
      );
    return { created: true, provider: generated.provider, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "建议生成失败";
    input.db
      .prepare(
        `UPDATE item_enrichments
         SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
      )
      .run(message, new Date().toISOString(), id);
    return { created: false, provider: null, error: message };
  }
}
