"use client";

import {
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  ImagePlus,
  Inbox,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
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
import type { DashboardData, Item, NotebookNote } from "@/lib/types";

type Tab = "today" | "later" | "notebook";
type Toast = { message: string; tone: "success" | "error" | "neutral" } | null;

const emptyDashboard: DashboardData = {
  today: [],
  quick: [],
  later: [],
  waiting: [],
  inbox: [],
  notebook: [],
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

function CaptureComposer({
  onCaptured
}: {
  onCaptured: (message: string, usedAI: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!candidate) return;
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
      if (file) body.set("attachment", file);
      const response = await fetch("/api/captures", { method: "POST", body });
      const result = (await response.json()) as {
        error?: string;
        message?: string;
        usedAI?: boolean;
      };
      if (!response.ok) throw new Error(result.error || "暂时没有安放成功。");
      setText("");
      clearFile();
      onCaptured(result.message || "已经替你记住了。", Boolean(result.usedAI));
      textareaRef.current?.focus();
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

  return (
    <form
      className={`capture ${submitting ? "is-processing" : ""}`}
      onSubmit={onSubmit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        chooseFile(event.dataTransfer.files[0]);
      }}
    >
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
        autoFocus
        placeholder="想到的事，先放在这里……"
        aria-label="记录一件事"
      />

      {preview && (
        <div className="capture-preview">
          {/* blob URL 只用于本地预览 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="待上传的截图" />
          <button type="button" onClick={clearFile} aria-label="移除截图">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="capture-footer">
        <div className="capture-tools">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            hidden
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className="quiet-button"
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
  );
}

function ItemCard({
  item,
  onChange
}: {
  item: Item;
  onChange: (message?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(item.needsConfirmation);
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
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "操作没有成功");
      onChange(message);
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

  const saveEdit = async () => {
    const saved = await action(
      {
        action: "edit",
        title: title.trim(),
        scheduledFor: dateValue ? new Date(dateValue).toISOString() : null,
        status: dateValue ? "scheduled" : "later"
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
    item.contextLabel,
    item.durationMinutes ? `${item.durationMinutes} 分钟` : null,
    item.sourceCount > 1 ? `${item.sourceCount} 条关联信息` : null,
    item.enrichmentCount ? `${item.enrichmentCount} 条 AI 建议` : null
  ].filter(Boolean);

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
    <article className={`item-card ${busy ? "is-busy" : ""}`}>
      <button
        className="complete-button"
        disabled={busy}
        onClick={() => void action({ action: "complete" }, "完成了，已经替你收好。")}
        aria-label={`完成：${item.title}`}
      >
        <Check size={16} />
      </button>
      <div className="item-main">
        <div className="item-title-row">
          <h3>{item.title}</h3>
          {item.priority === "urgent" || item.priority === "high" ? (
            <span className="priority-dot" title="需要关注" />
          ) : null}
        </div>
        <div className="item-meta">
          <button
            className="schedule-meta schedule-edit-button"
            onClick={beginEditing}
            aria-label={`修改时间：${formatSchedule(item.scheduledFor, item.timeWindow)}`}
            title="修改时间"
          >
            <Clock3 size={13} />
            {formatSchedule(item.scheduledFor, item.timeWindow)}
            <Pencil size={10} />
          </button>
          {metadata.map((meta) => (
            <span key={meta}>{meta}</span>
          ))}
          {item.extractionSource === "deepseek" && (
            <span className="ai-meta">
              <Sparkles size={11} /> AI 整理
            </span>
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

        {expanded && (
          <div className="item-detail">
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
            <div className="item-actions">
              <button className="suggestion-action" onClick={() => void requestSuggestion()}>
                <Sparkles size={12} />
                {item.enrichment ? "再给一条建议" : "给我建议"}
              </button>
              <span>稍后提醒</span>
              <button onClick={() => void action({ action: "snooze", preset: "hour" })}>
                一小时后
              </button>
              <button onClick={() => void action({ action: "snooze", preset: "tonight" })}>
                今晚
              </button>
              <button onClick={() => void action({ action: "snooze", preset: "tomorrow" })}>
                明天
              </button>
              <button onClick={() => void action({ action: "snooze", preset: "weekend" })}>
                周末
              </button>
              <button onClick={() => void action({ action: "waiting" })}>等待中</button>
              <button className="danger-text" onClick={() => void action({ action: "abandon" })}>
                不再处理
              </button>
            </div>
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
  icon
}: {
  title: string;
  eyebrow?: string;
  items: Item[];
  onChange: (message?: string) => void;
  icon?: React.ReactNode;
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
          <ItemCard key={item.id} item={item} onChange={onChange} />
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

export function AppShell() {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [toast, setToast] = useState<Toast>(null);
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
      void refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const handleChange = (message?: string) => {
    if (message) setToast({ message, tone: "success" });
    void refresh();
  };

  const todayEmpty = !data.today.length && !data.quick.length && !data.inbox.length;
  const laterCount = data.later.length + data.waiting.length + data.inbox.length;
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    return hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  }, []);

  const requestNotifications = async () => {
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
          <span>安放</span>
        </a>
        <nav className="main-nav" aria-label="主要页面">
          <button className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>
            今日
          </button>
          <button className={tab === "later" ? "active" : ""} onClick={() => setTab("later")}>
            稍后 {laterCount > 0 && <span>{laterCount}</span>}
          </button>
          <button
            className={tab === "notebook" ? "active" : ""}
            onClick={() => setTab("notebook")}
          >
            笔记 {data.notebook.length > 0 && <span>{data.notebook.length}</span>}
          </button>
        </nav>
        <div className="top-actions">
          <span className={`ai-status ${data.aiEnabled ? "connected" : ""}`}>
            <span /> {data.aiEnabled ? "DeepSeek 已连接" : "本地整理"}
          </span>
          <button
            className={`notification-button ${notificationState === "granted" ? "enabled" : ""}`}
            onClick={() => void requestNotifications()}
            title={notificationState === "granted" ? "系统提醒已开启" : "开启系统提醒"}
            aria-label={notificationState === "granted" ? "系统提醒已开启" : "开启系统提醒"}
          >
            <Bell size={18} />
          </button>
        </div>
      </header>

      <main id="top" className="main-content">
        {tab === "today" ? (
          <>
            <section className="welcome">
              <p className="date-line">{dateHeading()}</p>
              <h1>{greeting}，今天想安放什么？</h1>
              <p className="welcome-note">你只管记下来，整理和重新想起交给我。</p>
            </section>

            <CaptureComposer
              onCaptured={(message, usedAI) => {
                setToast({
                  message: usedAI ? message : `${message}（已用本地规则整理）`,
                  tone: "success"
                });
                void refresh();
              }}
            />

            {loading ? (
              <div className="page-loading">
                <LoaderCircle className="spin" size={20} /> 正在打开今天
              </div>
            ) : (
              <div className="sections-wrap">
                <Section
                  title="需要你确认"
                  eyebrow="AI 没有替你猜"
                  items={data.inbox}
                  onChange={handleChange}
                  icon={<Inbox size={17} />}
                />
                <Section
                  title="今天要紧的事"
                  eyebrow="先把有限的注意力留给这里"
                  items={data.today}
                  onChange={handleChange}
                  icon={<SunMedium size={17} />}
                />
                <Section
                  title="顺手处理"
                  eyebrow="适合短暂空闲"
                  items={data.quick}
                  onChange={handleChange}
                  icon={<Check size={17} />}
                />
                {todayEmpty && (
                  <div className="empty-state">
                    <div className="empty-orbit"><span /></div>
                    <h2>今天暂时没有催促你的事</h2>
                    <p>想到什么就放在上面。没有事情，也很好。</p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : tab === "later" ? (
          <section className="later-page">
            <div className="later-heading">
              <p className="date-line">不必现在处理</p>
              <h1>已经替你收好</h1>
              <p>事情留在这里，不会因为暂时做不了而消失。</p>
            </div>
            <Section
              title="等待中"
              eyebrow="条件满足后再继续"
              items={data.waiting}
              onChange={handleChange}
              icon={<Users size={17} />}
            />
            <Section
              title="需要确认"
              items={data.inbox}
              onChange={handleChange}
              icon={<Inbox size={17} />}
            />
            <Section
              title="稍后再做"
              eyebrow="系统会在每日回顾中让它们重新出现"
              items={data.later}
              onChange={handleChange}
              icon={<Clock3 size={17} />}
            />
            {!laterCount && (
              <div className="empty-state compact">
                <Upload size={22} />
                <h2>这里还是空的</h2>
                <p>没有明确时间的事情会安静地待在这里。</p>
              </div>
            )}
          </section>
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
        <button className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>
          <SunMedium size={19} />今日
        </button>
        <button className={tab === "later" ? "active" : ""} onClick={() => setTab("later")}>
          <Clock3 size={19} />稍后
        </button>
        <button
          className={tab === "notebook" ? "active" : ""}
          onClick={() => setTab("notebook")}
        >
          <BookOpen size={19} />笔记
        </button>
      </nav>

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
}
