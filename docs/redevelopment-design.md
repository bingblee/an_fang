# 安放重开发系统设计文档

版本：1.0

状态：技术设计基线

## 1. 设计目标

重开发优先建立可靠、可解释、可撤销的事项系统：

1. Capture 与 AI 解耦，任何输入先落库；
2. Item、Trigger、Reminder、Enrichment 边界清晰；
3. 用户数据按账号隔离，来源和修订可追溯；
4. AI 是可替换策略，不直接拥有写库权限；
5. 通知可重试、去重、可诊断；
6. 前端按功能域拆分；
7. 首发可单体部署，但为队列、Postgres、对象存储和外部连接保留接口。

## 2. 推荐架构

采用“模块化单体 + 独立后台 Worker”。Web、API、Worker 首发可部署在一台服务器，服务职责和数据边界先分清。

~~~text
┌──────────────────────────────┐
│ Web / PWA                     │
│ Today · Capture · Item · ...  │
└──────────────┬───────────────┘
               │ HTTPS / SSE or polling
┌──────────────▼───────────────┐
│ Application API               │
│ Auth · Capture · Items        │
│ Topics · Notebook · Context   │
└───────┬───────────┬──────────┘
        │           │
┌───────▼──────┐ ┌──▼──────────┐
│ SQLite /      │ │ Job Queue   │
│ PostgreSQL    │ │ AI · notify │
└───────────────┘ └──┬──────────┘
                      │
              ┌───────▼────────┐
              │ Worker          │
              │ AI adapter      │
              │ Trigger eval    │
              │ Push delivery   │
              └─────────────────┘
~~~

### 技术选择

- 前端继续使用 React + TypeScript + Next.js / PWA，但按当前仓库要求重新阅读对应版本的本地 Next.js guide，不假设旧版行为；
- 服务端可继续 Node.js，所有写入通过 use case，不从组件直接拼 SQL；
- 私有单机继续 SQLite；公网多实例预留 PostgreSQL；
- 首发可用 SQLite Job 表 + 单 Worker，生产再换 Redis / SQS / PostgreSQL queue；
- 私有附件目录 / 对象存储均可实现，数据库只存元数据和 key；
- DeepSeek 作为 ExtractionProvider / EnrichmentProvider adapter，本地规则作为 fallback；
- Web Push 作为 NotificationChannel，后续可接邮件、桌面或手机。

## 3. 模块边界

~~~text
modules/
  auth/             用户、密码、会话、设备
  capture/          原始输入、附件、处理状态
  intelligence/     抽取、候选、分类、合并建议、建议生成
  items/            状态、时间、反馈、版本
  scheduling/       Trigger、Review、时间窗口、勿扰
  reminders/        Reminder、渠道、投递、重试
  topics/           话题、分类、合集
  notebook/         笔记、搜索、来源
  context/          作息、人物、场景、规则
  search/           统一检索
  audit/            领域事件、诊断、安全日志
shared/
  db/ jobs/ http/ ai/
~~~

前端按 Capture、Today、Item、Later、Topics、Notebook、Settings 和通用 UI 组件拆分。AppShell 只负责布局、导航和跨域状态。

## 4. 数据模型

~~~text
User 1──N Session
User 1──N Capture 1──N Attachment
Capture 1──N AIExtraction
Capture N──N Item  (ItemSource)
Item 1──N ItemVersion
Item 1──N Trigger 1──N Reminder
Item 1──N Feedback
Item 1──N Enrichment 1──0..1 NotebookNote
User 1──N Topic
Topic 1──N Item
User 1──N ContextFact 1──N PersonalRule
~~~

| 表 | 关键字段 | 约束 |
| --- | --- | --- |
| users | id, username_key, password_hash | 用户名唯一 |
| sessions | token_hash, user_id, expires_at | 只存 Token 摘要 |
| captures | id, user_id, kind, original_text, source_url, status, idempotency_key | 原始输入 append-only |
| attachments | id, capture_id, object_key, mime_type, size, sha256 | 私有对象 |
| ai_extractions | capture_id, provider, model, prompt_version, result_json, error | 不覆盖旧版本 |
| items | 当前标题、备注、分类、状态、优先级、时间、置信度 | 当前投影 |
| item_sources | item_id, capture_id, relation | primary / supplement / enrichment |
| item_versions | item_id, snapshot_json, reason, created_at | 支持差异和撤销 |
| triggers | item_id, type, payload_json, active, next_at, timezone | time / review / context / waiting |
| reminders | trigger_id, channel, reason, status, dedupe_key | 去重键唯一 |
| feedback | item_id, kind, before_json, after_json | append-only |
| enrichments | item_id, capture_id, kind, request, content, provider, status | 多条可见历史 |
| notebook_notes | user_id, source_item_id, source_enrichment_id, title, content | 副本独立生命周期 |
| topics | user_id, name_key, description, status | 用户内名称唯一 |
| context_facts | user_id, fact_type, content_json, source, confirmed, sensitivity | 最小化读取 |
| jobs | user_id, type, payload_json, status, attempts, available_at, idempotency_key | 重试 / 死信 |

items 保存当前查询投影；影响用户理解的变化同时写 item_versions 和 feedback，支持查看“谁在什么时候改了什么”和恢复前一版本。

## 5. Capture 异步流程

~~~text
1. Client 生成 idempotencyKey
2. POST /captures
3. 校验会话、格式、大小和配额
4. 事务写 Capture=saved，附件写临时对象
5. 提交事务，返回 202 {captureId, jobId}
6. 创建 capture.process Job
7. Worker 读取最小相关上下文和候选
8. 调 ExtractionProvider，校验结构化结果
9. 生成 ProposedItem / MergeProposal / EnrichmentProposal
10. 事务写 Item / ItemSource / Trigger / AIExtraction
11. Capture=processed，Job=succeeded
12. 前端用 SSE 或轮询刷新局部结果
~~~

失败策略：

- Capture 和附件保留，状态为 failed；
- 可重试错误按 1m / 5m / 30m 退避，最多 5 次；
- 不可重试错误进入失败列表，允许本地规则或手动建 Item；
- JSON 校验失败不能直接写业务字段；
- 前端离开不影响后台；
- 同一幂等键不产生重复 Capture、Job 或 Item。

## 6. AI 设计

Provider 只返回经 Zod / JSON Schema 验证的纯数据，不直接写库、不决定权限、不生成 HTML、不执行外部动作。

~~~text
本地预筛选候选
    ↓
最小上下文 + Capture
    ↓
结构化模型输出
    ↓
服务端二次校验：用户、候选、话题、置信度、风险
    ↓
新建 Item / MergeProposal / EnrichmentProposal
    ↓
需要时请求用户确认
~~~

合并保护：

- 重新校验 mergeTargetId 属于当前用户、状态可变且满足话题约束；
- 置信度只用于排序，不代表覆盖授权；
- 默认创建 MergeProposal，展示字段级 before / after；
- 确认后写 ItemVersion、ItemSource、Feedback；
- 10 分钟内提供撤销，之后仍可从历史版本恢复；
- 不确定时新建或待确认。

建议安全：

- 医疗、法律、财务走安全模板，提示专业帮助；
- 只发送目标事项必要字段；
- 显示是否联网、来源和生成时间；
- 清洗模型返回的链接、Markdown、图片和脚本；
- 限制生成频率。

## 7. Trigger 和 Reminder

Worker 按 next_at 批量处理 active Trigger：

1. 检查 Item 状态；
2. 检查用户时区、工作日、勿扰和渠道策略；
3. 计算 eligible；
4. 创建带 dedupe_key 的 Reminder；
5. 投递渠道；
6. 记录 sent / failed / retry；
7. 更新 Trigger 的 next_at 或停用。

| 类型 | 首发 | 后续 |
| --- | --- | --- |
| time | 精确 ISO 时间 | 重复时间、时区转换 |
| review | review_at + 递增间隔 | 行为个性化间隔 |
| waiting | 用户检查时间 | 等待方事件 |
| context | 手动点击“我到了 / 我在电脑前” | 授权后的地点 / 设备 |
| digest | 每日 / 每周摘要 | 负荷感知计划 |

通知动作使用 signed action token 或短期授权链接；应用内操作使用版本号校验，防止旧通知覆盖新状态。

## 8. API 基线

统一 request id、错误码、分页 cursor 和响应 envelope。

~~~text
POST   /api/v1/captures
GET    /api/v1/captures/:id
POST   /api/v1/captures/:id/retry
POST   /api/v1/captures/:id/resolve

GET    /api/v1/today
GET    /api/v1/later?cursor=...
GET    /api/v1/search?q=...
GET    /api/v1/history?type=item&cursor=...

GET    /api/v1/items/:id
PATCH  /api/v1/items/:id
POST   /api/v1/items/:id/actions
GET    /api/v1/items/:id/sources
GET    /api/v1/items/:id/versions
POST   /api/v1/items/:id/merge-proposals/:proposalId/confirm
POST   /api/v1/items/:id/merge-proposals/:proposalId/undo

GET    /api/v1/context
POST   /api/v1/context/facts
PATCH  /api/v1/context/facts/:id
DELETE /api/v1/context/facts/:id
GET    /api/v1/notifications/settings
PATCH  /api/v1/notifications/settings
GET    /api/v1/notifications/deliveries
GET    /api/v1/account/export
~~~

所有 mutation 带 expectedVersion 或 If-Match，冲突返回 409 并显示差异。

## 9. 前端数据策略

- Today、Later、TopicDetail、Notebook、ItemDetail 分开 query；
- mutation 返回更新资源，局部替换，不依赖每次全量 dashboard；
- Capture 维护 saved / processing / ready / needs_confirmation / failed；
- 网络错误保留输入并支持重试；
- 乐观更新仅用于完成、折叠和导航，合并和状态变更等待服务端确认；
- 统一 Toast、Inline error、Dialog、Skeleton 和 EmptyState；
- SSE 不可用时采用 2 秒、10 秒、60 秒递增轮询。

## 10. 安全、观测和测试

### 安全

- 查询、service、附件三重校验 user_id；
- 会话、来源、推送绑定和数据导出均校验归属；
- 附件私有存储，下载使用 nosniff、no-store 和安全 Content-Disposition；
- 日志不记录原文、图片、密码、Token 和 API Key；
- 对 Capture、建议、导出和登录限流；
- 用户输入、OCR 和模型输出都执行大小、MIME、链接和脚本过滤。

### 观测

记录脱敏 request_id、capture_id、item_id、job_id、provider、model、prompt_version、队列等待、AI 耗时、触发评估、投递、重试、合并确认 / 撤销、迁移和备份结果。监控队列积压、模型失败率、通知失败率、数据库锁等待和权限隔离错误。

### 测试

- 单元：日期时区、复盘间隔、状态机、话题、合并、Schema、通知去重；
- 集成：先保存后异步、失败降级、合并撤销、跨用户隔离、迁移回滚；
- 浏览器：注册登录、文字 / 图片 / 链接、离开后回归、待确认、合并、五种动作、详情、主题和 320px；
- 安全：越权访问、附件路径穿越、MIME、CSRF、限流、Prompt injection、部署清单。

## 11. 迁移方案

1. 停止正式服务并备份 SQLite、uploads、VAPID 和配置；
2. 为旧 Capture、Item、ItemSource、Enrichment、Notebook 生成快照；
3. 旧 Item 映射为新当前投影，并生成初始 ItemVersion；
4. 旧 time / review Trigger 迁移，context Trigger 转为待确认，不假设已触达；
5. sourceExcerpt 作为摘要，完整来源从 Capture 还原；
6. 旧 notebook 状态迁移为独立 NotebookNote，保留来源；
7. 迁移后核对用户、Item、Capture、附件 hash、Topic、笔记数量；
8. 失败不切换新库，保留旧库只读回退；
9. 运行权限、附件和提醒一致性检查。

## 12. 开发前待定项

- 首发是私有单机还是公网多用户；
- SQLite Job 表还是独立队列；
- 是否继续 DeepSeek、视觉模型和成本上限；
- 是否需要网页实时通知；
- 附件保留期和是否允许导出原图；
- ContextFact 首批允许的敏感等级；
- 是否需要邮箱、Passkey 或邀请制；
- 320px 是否为强兼容下限。
