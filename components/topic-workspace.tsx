"use client";

import { ArrowLeft, ArrowUpRight, FolderOpen, LoaderCircle, Pencil, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Item, Topic, TopicDetail } from "@/lib/types";

function TopicForm({ topic, onSaved, onCancel }: {
  topic?: Topic;
  onSaved: (topic: Topic, message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(topic?.name || "");
  const [description, setDescription] = useState(topic?.description || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(topic ? `/api/topics/${topic.id}` : "/api/topics", {
        method: topic ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "话题暂时没有保存成功。");
      onSaved(result.topic, result.message || "话题已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "话题暂时没有保存成功。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="topic-form" onSubmit={(event) => void submit(event)}>
      <h2>{topic ? "编辑话题" : "新建话题"}</h2>
      <label>
        <span>话题名称</span>
        <input autoFocus value={name} maxLength={80} disabled={busy}
          placeholder="例如：秋季发布项目" onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>描述 <small>选填，帮助 AI 判断哪些事情属于这里</small></span>
        <textarea value={description} maxLength={500} rows={3} disabled={busy}
          placeholder="例如：新品发布的筹备、设计、物料和上线安排。" onChange={(event) => setDescription(event.target.value)} />
      </label>
      <div className="confirm-actions">
        <button className="primary-small" disabled={busy || !name.trim()}>
          {busy ? "正在保存…" : topic ? "保存修改" : "创建话题"}
        </button>
        <button type="button" className="text-button" disabled={busy} onClick={onCancel}>取消</button>
      </div>
      {error && <p className="capture-error" role="alert">{error}</p>}
    </form>
  );
}

export function TopicWorkspace({ topics, selectedId, onSelect, onChange, renderCapture, renderItems }: {
  topics: Topic[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (message?: string) => void;
  renderCapture: (topicId: string) => ReactNode;
  renderItems: (items: Item[], completed: boolean) => ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [loadError, setLoadError] = useState<{ id: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/topics/${selectedId}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "暂时无法读取这个话题。");
        if (controller.signal.aborted) return;
        setDetail(result);
        setLoadError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoadError({ id: selectedId!, message: cause instanceof Error ? cause.message : "暂时无法读取这个话题。" });
      }
    }
    void load();
    return () => controller.abort();
  }, [selectedId, topics, retry]);

  const saved = (topic: Topic, message: string) => {
    setCreating(false);
    setEditingId(null);
    onSelect(topic.id);
    onChange(message);
    setRetry((value) => value + 1);
  };

  if (selectedId) {
    const current = detail?.topic.id === selectedId ? detail : null;
    const topic = topics.find((entry) => entry.id === selectedId) || current?.topic;
    const error = loadError?.id === selectedId ? loadError.message : null;
    return (
      <section className="topics-page">
        <button className="topic-back text-button" onClick={() => { setEditingId(null); onSelect(null); }}>
          <ArrowLeft size={15} /> 全部话题
        </button>
        {topic && <div className="topic-detail-heading">
          <div>
            <p className="date-line"><FolderOpen size={14} /> 话题</p>
            <h1>{topic.name}</h1>
            {topic.description && <p className="topic-description">{topic.description}</p>}
          </div>
          <button className="quiet-button" onClick={() => setEditingId(editingId ? null : selectedId)}>
            <Pencil size={14} /> 编辑
          </button>
        </div>}
        {editingId === selectedId && topic && <TopicForm key={selectedId} topic={topic} onSaved={saved} onCancel={() => setEditingId(null)} />}
        {topic && renderCapture(selectedId)}
        {error && <p className="topic-load-error" role="alert">{error} <button className="text-button" onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
        {!current && !error && <div className="page-loading"><LoaderCircle className="spin" size={18} /> 正在打开话题</div>}
        {current && <div className="topic-items">
          {renderItems(current.items.filter((item) => item.status !== "completed"), false)}
          {renderItems(current.items.filter((item) => item.status === "completed"), true)}
          {!current.items.length && <div className="empty-state compact">
            <FolderOpen size={24} />
            <h2>话题建好了，记下第一件事吧</h2>
            <p>上面的输入会默认放进这个话题。</p>
          </div>}
        </div>}
      </section>
    );
  }

  return (
    <section className="topics-page">
      <div className="topic-page-heading">
        <div>
          <p className="date-line">把相关的事放在一起</p>
          <h1>话题</h1>
          <p>一个项目，或一件需要慢慢推进的事。</p>
        </div>
        <button className="primary-small" onClick={() => setCreating(true)} disabled={creating}>
          <Plus size={15} /> 新建话题
        </button>
      </div>
      {creating && <TopicForm onSaved={saved} onCancel={() => setCreating(false)} />}
      {topics.length ? <div className="topic-grid">
        {topics.map((topic) => <button className="topic-card" key={topic.id} onClick={() => onSelect(topic.id)}>
          <div className="topic-card-heading"><FolderOpen size={18} /><ArrowUpRight size={16} /></div>
          <h2>{topic.name}</h2>
          {topic.description && <p>{topic.description}</p>}
          <div className="topic-counts"><span><strong>{topic.openCount}</strong> 待处理</span><span>{topic.completedCount} 已完成</span></div>
        </button>)}
      </div> : !creating && <div className="empty-state compact">
        <FolderOpen size={26} />
        <h2>给正在推进的事一个位置</h2>
        <p>新建一个话题，或在首页输入“创建一个关于搬家计划的话题”。</p>
      </div>}
    </section>
  );
}
