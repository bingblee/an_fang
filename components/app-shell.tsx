"use client";

import {
  Bell,
  BookOpen,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock3,
  FolderOpen,
  ImagePlus,
  Inbox,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  SunMedium,
  Upload,
  Trash2,
  Users,
  X
} from "lucide-react";
import Image from "next/image";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { DashboardData, Item, ItemCategory, NotebookNote, Topic } from "@/lib/types";
import { TopicWorkspace } from "@/components/topic-workspace";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AppEnvironment } from "@/lib/runtime-config.mjs";
import { categoryIds, categoryLabels } from "@/lib/category-definitions";
import { CategoryShortcuts, CategoryWorkspace } from "@/components/category-workspace";

type Tab = "today" | "later" | "topics" | "notebook";
type Toast = { message: string; tone: "success" | "error" | "neutral" } | null;
type ComposerMode = "full" | "compact" | "docked";
type TodayGroupId = "important" | "doing" | "quick" | "review" | "inbox";

const emptyDashboard: DashboardData = {
  today: [],
  quick: [],
  doing: [],
  review: [],
  later: [],
  waiting: [],
  inbox: [],
  notebook: [],
  topics: [],
  categories: [],
  completedToday: 0,
  totalOpen: 0,
  aiEnabled: false
};

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateHeading() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("month")}月${value("day")}日，${value("weekday")}`;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function formatSchedule(value: string | null, windowLabel: string | null) {
  if (!value) return windowLabel || "等待安排";
  const date = new Date(value);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  if (sameDay(date, now)) return `今天 ${time}`;
  if (sameDay(date, tomorrow)) return `明天 ${time}`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

const statusLabels: Record<Item["status"], string> = {
  scheduled: "新任务",
  doing: "进行中",
  waiting: "等待中",
  later: "新任务",
  completed: "已完成",
  merged: "已合并",
  abandoned: "不再处理"
};

function formatReview(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date <= today) return "现在重新想起";
  if (date.toDateString() === tomorrow.toDateString()) return "明天再看看";
  return `${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date)} 再看看`;
}

function CaptureComposer({
  onCaptured,
  topics,
  initialTopicId = "auto",
  mode = "full",
  onExpand,
  onCollapse
}: {
  onCaptured: (message: string, usedAI: boolean, topicOnly?: boolean) => void;
  topics: Topic[];
  initialTopicId?: string;
  mode?: ComposerMode;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  const [topicChoice, setTopicChoice] = useState(initialTopicId);
  const [justCreated, setJustCreated] = useState<Topic | null>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shouldInitialFocus] = useState(() => mode === "full" && initialTopicId === "auto");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (shouldInitialFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [shouldInitialFocus]);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseFile = (candidate?: File) => {
    if (!candidate || submitting) return;
    if (!candidate.type.startsWith("image/")) {
      setError("现在先支持图片截图。");
      return;
    }
    if (candidate.size > 8 * 1024 * 1024) {
      setError("图片不能超过 8MB。");
      return;
    }
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setFile(candidate);
    setPreview(URL.createObjectURL(candidate));
  };

  const submit = async () => {
    if ((!text.trim() && !file) || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("text", text.trim());
      body.set("topicId", topicChoice);
      if (file) body.set("attachment", file);
      const response = await fetch("/api/captures", { method: "POST", body });
      const result = (await response.json()) as {
        error?: string;
        message?: string;
        usedAI?: boolean;
        kind?: string;
        createdTopic?: Topic;
      };
      if (!response.ok) throw new Error(result.error || "暂时没有安放成功。");
      setText("");
      clearFile();
      if (result.createdTopic && topicChoice === "auto") {
        setJustCreated(result.createdTopic);
        setTopicChoice(result.createdTopic.id);
      }
      onCaptured(result.message || "已经替你记住了。", Boolean(result.usedAI), result.kind === "topic");
      textareaRef.current?.focus({ preventScroll: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时没有安放成功。");
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  const expand = () => {
    onExpand?.();
    window.setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0);
  };

  const compactText = submitting
    ? "正在替你整理……"
    : text.trim()
      ? `继续记录：${text.trim()}`
      : file
        ? "有一张截图还在这里"
        : "记录一件新事情……";

  return (
    <div className={`capture-dock is-${mode}`}>
      {mode === "compact" ? (
        <button type="button" className="compact-capture" onClick={expand}
          aria-label={`${compactText}，点击展开输入框`}>
          <span className="compact-capture-mark"><Sparkles size={15} /></span>
          <span className="compact-capture-copy">
            <small>{submitting ? "AI 正在整理" : "随手安放"}</small>
            <strong>{compactText}</strong>
          </span>
          <span className="compact-capture-action">点击展开 <Maximize2 size={13} /></span>
        </button>
      ) : (
        <>
          {mode === "docked" && onCollapse && (
            <button type="button" className="capture-scrim" onClick={onCollapse}
              aria-label="收起输入框" />
          )}
          <form
            className={`capture ${submitting ? "is-processing" : ""}`}
            onSubmit={onSubmit}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            {mode === "docked" && onCollapse && (
              <button type="button" className="capture-collapse" onClick={onCollapse}>
                <Minimize2 size={13} /> 收起
              </button>
            )}
            <div className="capture-mark" aria-hidden="true">
              <Sparkles size={18} strokeWidth={1.8} />
            </div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(event) => {
                const pasted = Array.from(event.clipboardData.items).find((item) =>
                  item.type.startsWith("image/")
                );
                const pastedFile = pasted?.getAsFile();
                if (pastedFile) chooseFile(pastedFile);
              }}
              rows={3}
              placeholder="想到的事，先放在这里……"
              aria-label="记录一件事"
              readOnly={submitting}
            />

            {preview && (
              <div className="capture-preview">
                {/* blob URL 只用于本地预览 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="待上传的截图" />
                <button type="button" onClick={clearFile} disabled={submitting} aria-label="移除截图">
                  <X size={15} />
                </button>
              </div>
            )}

            <label className="capture-topic">
              <FolderOpen size={14} aria-hidden="true" />
              <span>话题</span>
              <select aria-label="归入话题" value={topicChoice} disabled={submitting}
                onChange={(event) => setTopicChoice(event.target.value)}>
                <option value="auto">AI 自动归类</option>
                <option value="none">未归类</option>
                {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
                {justCreated && !topics.some((topic) => topic.id === justCreated.id) &&
                  <option value={justCreated.id}>{justCreated.name}</option>}
              </select>
            </label>

            <div className="capture-footer">
              <div className="capture-tools">
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  hidden
                  disabled={submitting}
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className="quiet-button"
                  aria-label="添加截图"
                  disabled={submitting}
                  onClick={() => inputRef.current?.click()}
                >
                  <ImagePlus size={17} />
                  <span>截图</span>
                </button>
                <span className="capture-hint">支持文字、链接和粘贴图片</span>
              </div>
              <button
                className="place-button"
                type="submit"
                disabled={submitting || (!text.trim() && !file)}
              >
                {submitting ? (
                  <>
                    <LoaderCircle className="spin" size={17} /> 正在整理
                  </>
                ) : (
                  <>
                    安放 <span className="shortcut">⌘↵</span>
                  </>
                )}
              </button>
            </div>
            {error && <p className="capture-error">{error}</p>}
          </form>
        </>
      )}
    </div>
  );
}

function ItemCard({
  item,
  onChange,
  topics,
  onOpenTopic,
  onOpenCategory,
  planningActions = false
}: {
  item: Item;
  onChange: (message?: string) => void;
  topics: Topic[];
  onOpenTopic: (id: string) => void;
  onOpenCategory: (id: ItemCategory) => void;
  planningActions?: boolean;
}) {
  const completed = item.status === "completed";
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(item.needsConfirmation && !completed);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [dateValue, setDateValue] = useState(() => toLocalDateTime(item.scheduledFor));

  const action = async (body: object, message?: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "操作没有成功");
      onChange(result.message || message);
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "操作没有成功");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const beginEditing = () => {
    setTitle(item.title);
    setDateValue(toLocalDateTime(item.scheduledFor));
    setActionError(null);
    setEditing(true);
  };

  const beginTitleEdit = () => {
    setTitle(item.title);
    setActionError(null);
    setEditingTitle(true);
  };

  const saveTitle = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !title.trim()) return;
    if (await action({ action: "rename", title: title.trim() }, "标题已更新，时间和状态保持不变。")) setEditingTitle(false);
  };

  const saveEdit = async () => {
    const saved = await action(
      {
        action: "edit",
        title: title.trim(),
        scheduledFor: dateValue ? new Date(dateValue).toISOString() : null,
        status: dateValue ? "scheduled" : item.status === "waiting" ? "waiting" : "later"
      },
      "时间已经按你的修改更新。"
    );
    if (saved) setEditing(false);
  };

  const requestSuggestion = async () => {
    setBusy(true);
    setSuggestionError(null);
    try {
      const response = await fetch(`/api/items/${item.id}/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: "给我一条能明显帮助完成这件事的实用建议、步骤或清单"
        })
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "建议暂时没有生成");
      setExpanded(true);
      onChange(result.message || "建议已经附在这件事下面。");
    } catch (cause) {
      setSuggestionError(cause instanceof Error ? cause.message : "建议暂时没有生成");
    } finally {
      setBusy(false);
    }
  };

  const moveSuggestion = async (mode: "notebook" | "delete") => {
    if (!item.enrichment) return;
    setBusy(true);
    setSuggestionError(null);
    try {
      const response = await fetch(
        `/api/items/${item.id}/suggestions/${item.enrichment.id}`,
        mode === "delete"
          ? { method: "DELETE" }
          : {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "save_to_notebook" })
            }
      );
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "便笺暂时没有处理成功");
      onChange(result.message);
    } catch (cause) {
      setSuggestionError(cause instanceof Error ? cause.message : "便笺暂时没有处理成功");
    } finally {
      setBusy(false);
    }
  };

  const metadata = [
    item.person ? `与 ${item.person}` : null,
    // The former AI context labels sometimes repeated the category verbatim.
    item.contextLabel && !Object.values(categoryLabels).includes(item.contextLabel) ? item.contextLabel : null,
    item.durationMinutes ? `${item.durationMinutes} 分钟` : null,
    item.sourceCount > 1 ? `${item.sourceCount} 条关联信息` : null,
    item.enrichmentCount ? `${item.enrichmentCount} 条 AI 建议` : null
  ].filter(Boolean);
  const scheduleText = item.status === "doing" && !item.scheduledFor
    ? "今天"
    : formatSchedule(item.scheduledFor, item.timeWindow);

  if (editingTitle) {
    return <article className="item-card title-edit-card">
      <form onSubmit={(event) => void saveTitle(event)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { if (event.key === "Enter") event.preventDefault(); return; }
          if (event.key === "Escape" && !busy) setEditingTitle(false);
        }}>
        <label><span>事项标题</span>
          <input className="edit-title" aria-label="事项标题" value={title} maxLength={120} autoFocus disabled={busy}
            onChange={(event) => setTitle(event.target.value)} />
        </label>
        <p className="title-edit-hint">只改标题，不改变提醒时间、分类和完成状态。</p>
        <div className="confirm-actions">
          <button className="primary-small" disabled={busy || !title.trim()}>{busy ? "正在保存…" : "保存标题"}</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => setEditingTitle(false)}>取消</button>
        </div>
        {actionError && <p className="suggestion-error" role="alert">{actionError}</p>}
      </form>
    </article>;
  }

  if (editing) {
    return (
      <article className="item-card confirm-card">
        <div className="confirm-label">
          {item.needsConfirmation ? "需要你确认一下" : "修改事项与提醒时间"}
        </div>
        {item.confirmationQuestion && (
          <p className="confirmation-question">{item.confirmationQuestion}</p>
        )}
        {item.attachment && (
          <Image
            className="confirm-image"
            src={`/api/attachments/${item.attachment.id}`}
            alt={item.attachment.originalName}
            width={640}
            height={360}
            unoptimized
          />
        )}
        <input
          className="edit-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="事项标题"
          maxLength={120}
          disabled={busy}
        />
        <label className="date-field">
          <span>什么时候再出现</span>
          <input
            type="datetime-local"
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
          />
          {dateValue && (
            <button type="button" className="clear-date" onClick={() => setDateValue("")}>
              清除时间
            </button>
          )}
        </label>
        <div className="confirm-actions">
          <button
            className="primary-small"
            disabled={busy || !title.trim()}
            onClick={() => void saveEdit()}
          >
            保存修改
          </button>
          <button className="text-button" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
        {actionError && <p className="suggestion-error">{actionError}</p>}
      </article>
    );
  }

  return (
    <article className={`item-card ${busy ? "is-busy" : ""} ${completed ? "is-completed" : ""}`}>
      <button
        className="complete-button"
        disabled={busy || completed}
        onClick={() => void action({ action: "complete" }, "完成了，已经替你收好。")}
        aria-label={`${completed ? "已完成" : "完成"}：${item.title}`}
      >
        <Check size={16} />
      </button>
      <div className="item-main">
        <div className="item-title-row">
          <h3 aria-label={item.title}><button className="item-title-button" onClick={beginTitleEdit} disabled={busy}
            title="编辑标题" aria-label={`编辑标题：${item.title}`}>
            <span>{item.title}</span><Pencil size={12} aria-hidden="true" />
          </button></h3>
          {item.priority === "urgent" || item.priority === "high" ? (
            <span className="priority-dot" title="需要关注" />
          ) : null}
        </div>
        <div className="item-meta">
          <span className={`status-badge status-${item.status}`}>{statusLabels[item.status]}</span>
          <button
            className="schedule-meta schedule-edit-button"
            onClick={beginEditing}
            aria-label={`修改时间：${scheduleText}`}
            title="修改时间"
            disabled={busy || completed}
          >
            <Clock3 size={13} />
            {scheduleText}
            <Pencil size={10} />
          </button>
          <button className="category-badge" onClick={() => onOpenCategory(item.category)}
            aria-label={`查看${categoryLabels[item.category]}合集`}
            title={`${item.categoryManual ? "手动分类" : "自动分类"} · 查看合集`}>
            <Layers3 size={12} /> {categoryLabels[item.category]}
          </button>
          {item.topicId && item.topicName && (
            <button className="topic-badge" onClick={() => onOpenTopic(item.topicId!)}
              title={item.topicSource === "ai" ? "AI 自动归类，可在更多操作中修改" : "查看这个话题"}>
              <FolderOpen size={12} /> {item.topicName}
            </button>
          )}
          {metadata.map((meta) => (
            <span key={meta}>{meta}</span>
          ))}
          {item.extractionSource === "deepseek" && (
            <span className="ai-meta">
              <Sparkles size={11} /> AI 整理
            </span>
          )}
          {!item.scheduledFor && item.reviewAt && (
            <span className="review-meta"><RotateCcw size={11} /> {formatReview(item.reviewAt)}</span>
          )}
        </div>

        {!expanded && item.enrichment && (
          <button className="suggestion-peek" onClick={() => setExpanded(true)}>
            <span className="suggestion-peek-mark">
              <Sparkles size={12} /> 建议便笺
            </span>
            <span>{item.enrichment.summary}</span>
          </button>
        )}

        {planningActions && !completed && (
          <div className="planning-actions" aria-label={`决定下一步：${item.title}`}>
            <span className="planning-label">下一步</span>
            <button className="planning-primary" disabled={busy || item.status === "doing"}
              onClick={() => void action({ action: "start" })}>
              <Play size={12} /> 今天做
            </button>
            <button disabled={busy} onClick={beginEditing}>
              <CalendarPlus size={12} /> 安排时间
            </button>
            <button disabled={busy} onClick={() => void action({ action: "keep_later" })}>
              <RotateCcw size={12} /> 继续放着
            </button>
            <button disabled={busy || item.status === "waiting"}
              onClick={() => void action({ action: "waiting" }, "已标记为等待中。")}>等待中</button>
            <button className="planning-abandon" disabled={busy}
              onClick={() => void action({ action: "abandon" }, "这件事不会再提醒你。")}>不再处理</button>
          </div>
        )}

        {expanded && (
          <div className="item-detail">
            <label className="item-topic-editor">
              <Layers3 size={14} /><span>所属分类</span>
              <select aria-label={`调整分类：${item.title}`} value={item.category} disabled={busy}
                onChange={(event) => void action({ action: "set_category", category: event.target.value }, "分类已更新；之后补充内容会保留你的选择。") }>
                {categoryIds.map((id) => <option key={id} value={id}>{categoryLabels[id]}</option>)}
              </select>
              <small>{item.categoryManual ? "手动指定" : "自动识别，可修改"}</small>
            </label>
            <label className="item-topic-editor">
              <FolderOpen size={14} />
              <span>所属话题</span>
              <select aria-label={`调整话题：${item.title}`} value={item.topicId || "none"} disabled={busy}
                onChange={(event) => void action({ action: "set_topic", topicId: event.target.value === "none" ? null : event.target.value }, "话题归属已更新。") }>
                <option value="none">未归类</option>
                {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
              </select>
              <small>{item.topicSource === "ai" ? "AI 归类" : item.topicSource === "rule" ? "名称匹配" : item.topicSource === "manual" ? "手动指定" : "尚未归类"}</small>
            </label>
            {item.attachment && (
              <Image
                src={`/api/attachments/${item.attachment.id}`}
                alt={item.attachment.originalName}
                width={560}
                height={320}
                unoptimized
              />
            )}
            {item.sourceExcerpt && (
              <blockquote>
                <Paperclip size={14} />
                <span>{item.sourceExcerpt}</span>
              </blockquote>
            )}
            {item.enrichment && (
              <aside className="enrichment-card">
                <div className="enrichment-heading">
                  <span>
                    <Sparkles size={13} /> AI 建议
                  </span>
                  <span>{item.enrichment.kind === "requested" ? "按你的要求" : "顺手补充"}</span>
                </div>
                <h4>{item.enrichment.title}</h4>
                <p>{item.enrichment.summary}</p>
                <div className="enrichment-content">{item.enrichment.content}</div>
                <div className="enrichment-footer">
                  <small>基于模型知识生成，未联网核验</small>
                  <div className="enrichment-actions">
                    <button onClick={() => void moveSuggestion("notebook")}>
                      <BookOpen size={12} /> 复制到笔记本
                    </button>
                    <button onClick={() => void moveSuggestion("delete")}>
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              </aside>
            )}
            {!completed && <div className="item-actions">
              <button className="suggestion-action" onClick={() => void requestSuggestion()}>
                <Sparkles size={12} />
                {item.enrichment ? "再给一条建议" : "给我建议"}
              </button>
              {!planningActions && <>
                <span>状态</span>
                <button disabled={item.status === "doing"} onClick={() => void action({ action: "start" })}>今天做</button>
                <button onClick={beginEditing}>安排时间</button>
                <button onClick={() => void action({ action: "later" })}>放回稍后</button>
                <button disabled={item.status === "waiting"}
                  onClick={() => void action({ action: "waiting" }, "已标记为等待中。")}>等待中</button>
                <button className="danger-text" onClick={() => void action({ action: "abandon" }, "这件事不会再提醒你。") }>
                  不再处理
                </button>
              </>}
            </div>}
            {suggestionError && <p className="suggestion-error">{suggestionError}</p>}
            {actionError && <p className="suggestion-error">{actionError}</p>}
          </div>
        )}
      </div>
      <button
        className="more-button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label="更多操作"
      >
        {expanded ? <ChevronDown size={18} /> : <MoreHorizontal size={19} />}
      </button>
    </article>
  );
}

function Section({
  title,
  eyebrow,
  items,
  onChange,
  icon,
  topics,
  onOpenTopic,
  onOpenCategory,
  planningActions = false
}: {
  title: string;
  eyebrow?: string;
  items: Item[];
  onChange: (message?: string) => void;
  icon?: React.ReactNode;
  topics: Topic[];
  onOpenTopic: (id: string) => void;
  onOpenCategory: (id: ItemCategory) => void;
  planningActions?: boolean;
}) {
  if (!items.length) return null;
  return (
    <section className="task-section">
      <div className="section-heading">
        <div className="section-title">
          {icon}
          <h2>{title}</h2>
          <span>{items.length}</span>
        </div>
        {eyebrow && <p>{eyebrow}</p>}
      </div>
      <div className="item-list">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} onChange={onChange} topics={topics}
            onOpenTopic={onOpenTopic} onOpenCategory={onOpenCategory} planningActions={planningActions} />
        ))}
      </div>
    </section>
  );
}

function formatNoteDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function NotebookCard({
  note,
  onChange
}: {
  note: NotebookNote;
  onChange: (message?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(note.title);
  const [summary, setSummary] = useState(note.summary);
  const [content, setContent] = useState(note.content);

  const beginEdit = () => {
    setTitle(note.title);
    setSummary(note.summary);
    setContent(note.content);
    setDeleteConfirm(false);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/notebook/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          summary: summary.trim(),
          content: content.trim()
        })
      });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "笔记暂时没有保存成功");
      setEditing(false);
      onChange(result.message || "笔记已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "笔记暂时没有保存成功");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/notebook/${note.id}`, { method: "DELETE" });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error || "笔记暂时没有删除成功");
      onChange(result.message || "笔记已删除。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "笔记暂时没有删除成功");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`notebook-card ${expanded ? "expanded" : ""} ${busy ? "is-busy" : ""}`}>
      <button className="notebook-card-heading" onClick={() => setExpanded((value) => !value)}>
        <div>
          <span>{formatNoteDate(note.createdAt)}</span>
          <h3>{note.title}</h3>
          <p>{note.summary}</p>
        </div>
        <ChevronDown size={17} />
      </button>
      {expanded && (
        <div className="notebook-content">
          {editing ? (
            <div className="notebook-editor">
              <label>
                <span>标题</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                <span>摘要</span>
                <input value={summary} onChange={(event) => setSummary(event.target.value)} />
              </label>
              <label>
                <span>正文</span>
                <textarea
                  rows={10}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                />
              </label>
              <div className="notebook-edit-actions">
                <button
                  className="primary-small"
                  disabled={busy || !title.trim() || !content.trim()}
                  onClick={() => void save()}
                >
                  保存
                </button>
                <button className="text-button" onClick={() => setEditing(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="notebook-note-body">{note.content}</div>
              <div className="notebook-meta-row">
                {note.sourceItemTitle && <small>来自事项：{note.sourceItemTitle}</small>}
                <div className="notebook-actions">
                  <button onClick={beginEdit}>
                    <Pencil size={12} /> 编辑
                  </button>
                  {deleteConfirm ? (
                    <>
                      <button className="confirm-delete" onClick={() => void remove()}>
                        确认删除
                      </button>
                      <button onClick={() => setDeleteConfirm(false)}>取消</button>
                    </>
                  ) : (
                    <button onClick={() => setDeleteConfirm(true)}>
                      <Trash2 size={12} /> 删除
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          {error && <p className="suggestion-error">{error}</p>}
        </div>
      )}
    </article>
  );
}

function NotebookPage({
  notes,
  onChange
}: {
  notes: NotebookNote[];
  onChange: (message?: string) => void;
}) {
  return (
    <section className="notebook-page">
      <div className="later-heading notebook-heading">
        <p className="date-line">值得留下的内容</p>
        <h1>笔记本</h1>
        <p>从事项里保存的做法、清单和参考副本，会安静地留在这里。</p>
      </div>
      {notes.length ? (
        <div className="notebook-list">
          {notes.map((note) => (
            <NotebookCard key={note.id} note={note} onChange={onChange} />
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <BookOpen size={23} />
          <h2>笔记本还是空的</h2>
          <p>在 AI 建议便笺里选择“复制到笔记本”，内容就会来到这里。</p>
        </div>
      )}
    </section>
  );
}

export function AppShell({ environment, remindersEnabled }: { environment: AppEnvironment; remindersEnabled: boolean }) {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ItemCategory | null>(null);
  const [collectionReturn, setCollectionReturn] = useState<{ tab: Tab; topicId: string | null }>({ tab: "topics", topicId: null });
  const [toast, setToast] = useState<Toast>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>("full");
  const [todayGroup, setTodayGroup] = useState<TodayGroupId | null>(null);
  const lastScrollYRef = useRef(0);
  const [notificationState, setNotificationState] = useState<NotificationPermission | "unsupported">(
    "unsupported"
  );

  const refresh = useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) throw new Error("暂时无法读取事项");
    const result = (await response.json()) as DashboardData;
    setData(result);
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => {
        setLoading(false);
        setToast({ message: "暂时无法读取已经保存的事项。", tone: "error" });
      });
      if ("Notification" in window) setNotificationState(Notification.permission);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh().catch(() => { /* Keep the last readable dashboard during a temporary disconnection. */ });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (tab !== "today") return;
    const collapseThreshold = window.innerWidth <= 820 ? 56 : 72;
    const startingY = window.scrollY;
    lastScrollYRef.current = startingY >= collapseThreshold ? startingY - 3 : startingY;
    let frame: number | null = null;
    let touchStartY: number | null = null;
    const expandFromPull = () => {
      setComposerMode((current) => current === "compact" ? "full" : current);
    };
    const updateComposer = () => {
      const nextY = window.scrollY;
      if (nextY >= collapseThreshold && nextY > lastScrollYRef.current + 2) {
        // Compacting changes the document height. Keep this transition one-way
        // until the user clicks the prompt, otherwise a short page can bounce
        // across the threshold and make the composer flash continuously.
        setComposerMode((current) => current === "full" ? "compact" : current);
      }
      lastScrollYRef.current = nextY;
      frame = null;
    };
    const onScroll = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateComposer);
    };
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (touchStartY !== null && currentY !== undefined && window.scrollY <= 8 && currentY - touchStartY >= 36) {
        expandFromPull();
        touchStartY = null;
      }
    };
    const onTouchEnd = () => { touchStartY = null; };
    const onWheel = (event: WheelEvent) => {
      if (window.scrollY <= 8 && event.deltaY < -8) expandFromPull();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    frame = window.requestAnimationFrame(updateComposer);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [tab]);

  const handleChange = (message?: string) => {
    if (message) setToast({ message, tone: "success" });
    void refresh().catch(() => setToast({ message: "已保存，但列表刷新失败，请稍后重试。", tone: "error" }));
  };

  const handleCaptured = (message: string, usedAI: boolean, topicOnly?: boolean) => {
    handleChange(usedAI || topicOnly ? message : `${message}（已用本地规则整理）`);
  };
  const navigate = (next: Tab) => {
    setActiveCategory(null);
    setTab(next);
    setComposerMode("full");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const selectTopic = (id: string | null) => {
    setActiveTopicId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openTopic = (id: string) => { selectTopic(id); navigate("topics"); };
  const openCategory = (id: ItemCategory) => {
    if (!activeCategory) setCollectionReturn({ tab, topicId: activeTopicId });
    setActiveCategory(id);
    setTab("topics");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const closeCategory = () => {
    setActiveCategory(null);
    setTab(collectionReturn.tab);
    setActiveTopicId(collectionReturn.topicId);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const sectionProps = { topics: data.topics, onOpenTopic: openTopic, onOpenCategory: openCategory, onChange: handleChange };

  const todayEmpty = !data.today.length && !data.quick.length && !data.doing.length &&
    !data.review.length && !data.inbox.length;
  const laterCount = data.later.length + data.waiting.length + data.inbox.length;
  const scheduledLater = data.later.filter((item) => Boolean(item.scheduledFor));
  const unscheduledLater = data.later.filter((item) => !item.scheduledFor);
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  }, []);
  const todayGroups = [
    {
      id: "important" as const,
      tabLabel: "要紧",
      title: "今天要紧的事",
      eyebrow: "先把有限的注意力留给这里",
      items: data.today,
      icon: <SunMedium size={16} />,
      planningActions: false,
      empty: "今天暂时没有必须优先处理的事。"
    },
    {
      id: "doing" as const,
      tabLabel: "进行中",
      title: "正在做",
      eyebrow: "今天已经开始的事",
      items: data.doing,
      icon: <Play size={16} />,
      planningActions: false,
      empty: "还没有开始中的事项。"
    },
    {
      id: "quick" as const,
      tabLabel: "顺手",
      title: "顺手处理",
      eyebrow: "适合短暂空闲",
      items: data.quick,
      icon: <Check size={16} />,
      planningActions: false,
      empty: "现在没有适合顺手处理的小事。"
    },
    {
      id: "review" as const,
      tabLabel: "重新想起",
      title: "重新想起",
      eyebrow: "每次最多三件，由你决定下一步",
      items: data.review,
      icon: <RotateCcw size={16} />,
      planningActions: true,
      empty: "暂时没有需要重新拿回眼前的事项。"
    },
    {
      id: "inbox" as const,
      tabLabel: "待确认",
      title: "需要你确认",
      eyebrow: "AI 没有替你猜",
      items: data.inbox,
      icon: <Inbox size={16} />,
      planningActions: false,
      empty: "没有需要你补充确认的内容。"
    }
  ];
  const defaultTodayGroupId = todayGroups.find((group) => group.items.length)?.id || "important";
  const activeTodayGroupId = todayGroup || defaultTodayGroupId;

  const requestNotifications = async () => {
    if (!remindersEnabled) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setToast({ message: "当前浏览器不支持系统通知。", tone: "neutral" });
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationState(permission);
      if (permission !== "granted") {
        setToast({ message: "你可以稍后在浏览器设置中开启提醒。", tone: "neutral" });
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const keyResponse = await fetch("/api/push/public-key", { cache: "no-store" });
      const { publicKey } = (await keyResponse.json()) as { publicKey: string };
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        }));
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON())
      });
      if (!response.ok) throw new Error("提醒订阅保存失败");
      setToast({ message: "提醒已经开启，离开页面也不会错过。", tone: "success" });
    } catch {
      setToast({ message: "提醒暂时没有开启，请稍后再试。", tone: "error" });
    }
  };

  return (
    <div className="app-frame">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="安放首页">
          <span className="brand-stamp">安</span>
          <span className="brand-copy">
            <strong>安放</strong>
            <small>LIFE NAVIGATOR</small>
          </span>
        </a>
        {environment !== "production" && <span className="environment-badge" role="status">{environment === "development" ? "开发环境" : "自动化测试"} · 测试数据</span>}
        <nav className="main-nav" aria-label="主要页面">
          <button className={tab === "today" ? "active" : ""} onClick={() => navigate("today")}>
            <span className="nav-icon"><SunMedium size={16} /></span>
            <span className="nav-label">今日</span>
          </button>
          <button className={tab === "later" ? "active" : ""} onClick={() => navigate("later")}>
            <span className="nav-icon"><Clock3 size={16} /></span>
            <span className="nav-label">稍后</span>
            {laterCount > 0 && <span className="nav-count">{laterCount}</span>}
          </button>
          <button
            className={tab === "topics" ? "active" : ""}
            onClick={() => { selectTopic(null); navigate("topics"); }}
          >
            <span className="nav-icon"><FolderOpen size={16} /></span>
            <span className="nav-label">话题</span>
          </button>
          <button
            className={tab === "notebook" ? "active" : ""}
            onClick={() => navigate("notebook")}
          >
            <span className="nav-icon"><BookOpen size={16} /></span>
            <span className="nav-label">笔记</span>
            {data.notebook.length > 0 && <span className="nav-count">{data.notebook.length}</span>}
          </button>
        </nav>
        <div className="top-actions">
          <span className={`ai-status ${data.aiEnabled ? "connected" : ""}`}>
            <span /> {data.aiEnabled ? "DeepSeek 已连接" : "本地整理"}
          </span>
          <ThemeToggle />
          <button
            className={`notification-button ${notificationState === "granted" ? "enabled" : ""}`}
            disabled={!remindersEnabled}
            onClick={() => void requestNotifications()}
            title={!remindersEnabled ? "当前环境不发送系统提醒" : notificationState === "granted" ? "系统提醒已开启" : "开启系统提醒"}
            aria-label={!remindersEnabled ? "当前环境不发送系统提醒" : notificationState === "granted" ? "系统提醒已开启" : "开启系统提醒"}
          >
            <Bell size={18} />
          </button>
        </div>
      </header>

      <main id="top" className="main-content">
        {activeCategory ? (
          <CategoryWorkspace categories={data.categories} selectedId={activeCategory} onSelect={openCategory} onBack={closeCategory}
            backLabel={collectionReturn.tab === "today" ? "返回今日" : collectionReturn.tab === "later" ? "返回稍后" : collectionReturn.topicId ? "返回话题" : "全部话题"}
            renderItems={(items, completed) => <Section {...sectionProps} title={completed ? "已完成" : "待处理"} items={items}
              icon={completed ? <Check size={17} /> : <Layers3 size={17} />} />}
          />
        ) : tab === "today" ? (
          <>
            <section className="today-deck">
              <section className="welcome">
                <p className="date-line">{dateHeading()}</p>
                <h1>{greeting}，今天想安放什么？</h1>
                <div className="hero-readout" aria-label="今日概览">
                  <span><strong>{data.today.length + data.quick.length + data.doing.length + data.review.length}</strong> 在眼前</span>
                  <span><strong>{data.totalOpen}</strong> 替你记着</span>
                </div>
              </section>

              <CaptureComposer
                topics={data.topics}
                onCaptured={handleCaptured}
                mode={composerMode}
                onExpand={() => setComposerMode("docked")}
                onCollapse={() => setComposerMode("compact")}
              />
            </section>

            {loading ? (
              <div className="page-loading">
                <LoaderCircle className="spin" size={20} /> 正在打开今天
              </div>
            ) : (
              <div className="sections-wrap">
                <nav className="today-task-tabs" role="tablist" aria-label="今日任务分类">
                  {todayGroups.map((group) => (
                    <button key={group.id} type="button" role="tab"
                      id={`today-tab-${group.id}`}
                      aria-selected={group.id === activeTodayGroupId}
                      aria-controls={`today-panel-${group.id}`}
                      tabIndex={group.id === activeTodayGroupId ? 0 : -1}
                      className={group.id === activeTodayGroupId ? "active" : ""}
                      onClick={() => setTodayGroup(group.id)}
                      onKeyDown={(event) => {
                        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                        event.preventDefault();
                        const current = todayGroups.findIndex((entry) => entry.id === group.id);
                        const nextIndex = event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? todayGroups.length - 1
                            : (current + (event.key === "ArrowRight" ? 1 : -1) + todayGroups.length) % todayGroups.length;
                        const nextGroup = todayGroups[nextIndex]!;
                        setTodayGroup(nextGroup.id);
                        window.requestAnimationFrame(() => document.getElementById(`today-tab-${nextGroup.id}`)?.focus());
                      }}>
                      <span className="today-tab-icon">{group.icon}</span>
                      <span>{group.tabLabel}</span>
                      <em>{group.items.length}</em>
                    </button>
                  ))}
                </nav>
                {todayGroups.map((group) => (
                  <div key={group.id} className="today-tab-panel" role="tabpanel"
                    id={`today-panel-${group.id}`}
                    aria-labelledby={`today-tab-${group.id}`}
                    hidden={group.id !== activeTodayGroupId}>
                    {group.items.length ? (
                      <Section {...sectionProps} title={group.title}
                        eyebrow={group.eyebrow} items={group.items}
                        icon={group.icon} planningActions={group.planningActions} />
                    ) : (
                      <div className="empty-state compact today-group-empty">
                        {todayEmpty ? <div className="empty-orbit"><span /></div> : group.icon}
                        <h2>{todayEmpty ? "今天暂时没有催促你的事" : `${group.tabLabel}里暂时没有事项`}</h2>
                        <p>{todayEmpty ? "想到什么就放在上面。没有事情，也很好。" : group.empty}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : tab === "later" ? (
          <section className="later-page">
            <div className="later-heading">
              <p className="date-line">不必现在处理</p>
              <h1>已经替你收好</h1>
              <p>有时间的按时回来；没时间的按节奏重新出现。</p>
            </div>
            <Section
              {...sectionProps}
              title="等待中"
              eyebrow="等别人、等条件，暂时不催你"
              items={data.waiting}
              icon={<Users size={17} />}
              planningActions
            />
            <Section
              {...sectionProps}
              title="需要确认"
              items={data.inbox}
              onChange={handleChange}
              icon={<Inbox size={17} />}
            />
            <Section
              {...sectionProps}
              title="已有安排"
              eyebrow="到了你定的时间，它会回到今日"
              items={scheduledLater}
              icon={<CalendarPlus size={17} />}
              planningActions
            />
            <Section
              {...sectionProps}
              title="暂未安排"
              eyebrow="系统会逐步拉长间隔，不让稍后变成仓库"
              items={unscheduledLater}
              icon={<Clock3 size={17} />}
              planningActions
            />
            {!laterCount && (
              <div className="empty-state compact">
                <Upload size={22} />
                <h2>这里还是空的</h2>
                <p>没有明确时间的事情会安静地待在这里。</p>
              </div>
            )}
          </section>
        ) : tab === "topics" ? (
          loading ? <div className="page-loading"><LoaderCircle className="spin" size={20} /> 正在打开话题</div> :
          <TopicWorkspace topics={data.topics} selectedId={activeTopicId} onSelect={selectTopic} onChange={handleChange}
            overviewExtra={<CategoryShortcuts categories={data.categories} onSelect={openCategory} />}
            renderCapture={(topicId) => <CaptureComposer key={topicId} topics={data.topics} initialTopicId={topicId} onCaptured={handleCaptured} />}
            renderItems={(items, completed) => <Section {...sectionProps} title={completed ? "已完成" : "待处理"} items={items}
              icon={completed ? <Check size={17} /> : <FolderOpen size={17} />} />}
          />
        ) : (
          <NotebookPage notes={data.notebook} onChange={handleChange} />
        )}

        <footer className="daily-footer">
          <span>
            {tab === "notebook"
              ? "笔记不催促你，只在需要时回来查看"
              : data.completedToday
                ? `今天已经放下 ${data.completedToday} 件事`
                : "慢慢来，不需要填满一天"}
          </span>
          <span>
            {tab === "notebook"
              ? `已留下 ${data.notebook.length} 条内容`
              : data.totalOpen
                ? `还有 ${data.totalOpen} 件事由我替你记着`
                : "现在没有悬着的事"}
          </span>
        </footer>
      </main>

      <nav className="mobile-nav" aria-label="移动端页面">
        <button className={tab === "today" ? "active" : ""} onClick={() => navigate("today")}>
          <SunMedium size={19} />今日
        </button>
        <button className={tab === "later" ? "active" : ""} onClick={() => navigate("later")}>
          <Clock3 size={19} />稍后
        </button>
        <button
          className={tab === "topics" ? "active" : ""}
          onClick={() => { selectTopic(null); navigate("topics"); }}
        >
          <FolderOpen size={19} />话题
        </button>
        <button
          className={tab === "notebook" ? "active" : ""}
          onClick={() => navigate("notebook")}
        >
          <BookOpen size={19} />笔记
        </button>
      </nav>

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
}
