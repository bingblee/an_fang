"use client";

import { ArrowLeft, Layers3, LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { categoryDescriptions, categoryLabels } from "@/lib/category-definitions";
import type { CategoryDetail, CategorySummary, Item, ItemCategory } from "@/lib/types";

export function CategoryShortcuts({ categories, selectedId, onSelect }: {
  categories: CategorySummary[];
  selectedId?: ItemCategory;
  onSelect: (id: ItemCategory) => void;
}) {
  return <section className="category-shortcuts" aria-label="分类合集">
    <div className="category-shortcuts-heading"><span><Layers3 size={14} /> 按分类查看</span><small>数字为待处理事项</small></div>
    <div className="category-chips">
      {categories.map((category) => <button key={category.id} className={`category-chip ${selectedId === category.id ? "active" : ""}`}
        aria-pressed={selectedId === category.id}
        aria-label={`${category.name}，${category.openCount} 待处理，${category.completedCount} 已完成`}
        onClick={() => onSelect(category.id)}>
        {category.name}<span>{category.openCount}</span>
      </button>)}
    </div>
  </section>;
}

export function CategoryWorkspace({ categories, selectedId, onSelect, onBack, backLabel, renderItems }: {
  categories: CategorySummary[];
  selectedId: ItemCategory;
  onSelect: (id: ItemCategory) => void;
  onBack: () => void;
  backLabel: string;
  renderItems: (items: Item[], completed: boolean) => ReactNode;
}) {
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [loadError, setLoadError] = useState<{ id: ItemCategory; message: string } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/categories/${selectedId}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "暂时无法读取这个分类。");
        if (controller.signal.aborted) return;
        setDetail(result);
        setLoadError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoadError({ id: selectedId, message: cause instanceof Error ? cause.message : "暂时无法读取这个分类。" });
      }
    }
    void load();
    return () => controller.abort();
  }, [selectedId, categories, retry]);

  const current = detail?.category.id === selectedId ? detail : null;
  const error = loadError?.id === selectedId ? loadError.message : null;
  return <section className="topics-page category-page">
    <button className="topic-back text-button" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button>
    <div className="topic-detail-heading">
      <div>
        <p className="date-line"><Layers3 size={14} /> 分类合集</p>
        <h1>{categoryLabels[selectedId]}</h1>
        <p className="topic-description">{categoryDescriptions[selectedId]}</p>
      </div>
    </div>
    <CategoryShortcuts categories={categories} selectedId={selectedId} onSelect={onSelect} />
    {error && <p className="topic-load-error" role="alert">{error} <button className="text-button" onClick={() => setRetry((value) => value + 1)}>重试</button></p>}
    {!current && !error && <div className="page-loading"><LoaderCircle className="spin" size={18} /> 正在打开合集</div>}
    {current && <div className="topic-items">
      {renderItems(current.items.filter((item) => item.status !== "completed"), false)}
      {renderItems(current.items.filter((item) => item.status === "completed"), true)}
      {!current.items.length && <div className="empty-state compact">
        <Layers3 size={24} />
        <h2>还没有{categoryLabels[selectedId]}事项</h2>
        <p>AI 会自动分类，你也可以在事项的“更多操作”中调整分类。</p>
      </div>}
    </div>}
  </section>;
}
