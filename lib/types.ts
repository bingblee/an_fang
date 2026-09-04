import type { CategoryId } from "@/lib/category-definitions";

export type ItemStatus =
  | "scheduled"
  | "doing"
  | "waiting"
  | "later"
  | "completed"
  | "merged"
  | "abandoned";

export type ItemCategory = CategoryId;

export interface CategorySummary {
  id: ItemCategory;
  name: string;
  description: string;
  openCount: number;
  completedCount: number;
}

export interface CategoryDetail {
  category: CategorySummary;
  items: Item[];
}

export type Priority = "urgent" | "high" | "normal" | "low";
export type Energy = "low" | "medium" | "high";

export type TopicSource = "manual" | "ai" | "rule" | null;

export interface Topic {
  id: string;
  name: string;
  description: string;
  openCount: number;
  completedCount: number;
  createdAt: string;
}

export interface TopicDetail {
  topic: Topic;
  items: Item[];
}

export interface ItemEnrichment {
  id: string;
  kind: "requested" | "proactive";
  title: string;
  summary: string;
  content: string;
  request: string | null;
  provider: "deepseek" | "local";
  createdAt: string;
}

export interface NotebookNote {
  id: string;
  title: string;
  summary: string;
  content: string;
  sourceItemTitle: string | null;
  provider: "deepseek" | "local" | "manual";
  createdAt: string;
}

export interface Item {
  id: string;
  topicId: string | null;
  topicName: string | null;
  topicSource: TopicSource;
  captureId: string;
  title: string;
  notes: string | null;
  category: ItemCategory;
  categoryManual: boolean;
  status: ItemStatus;
  priority: Priority;
  durationMinutes: number | null;
  energy: Energy;
  person: string | null;
  contextLabel: string | null;
  scheduledFor: string | null;
  reviewAt: string | null;
  reviewIntervalDays: number | null;
  timeWindow: string | null;
  sourceExcerpt: string | null;
  extractionSource: "deepseek" | "local";
  confidence: number;
  needsConfirmation: boolean;
  confirmationQuestion: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  sourceCount: number;
  enrichmentCount: number;
  enrichment: ItemEnrichment | null;
  attachment?: {
    id: string;
    mimeType: string;
    originalName: string;
  } | null;
}

export interface MergeCandidate {
  id: string;
  topicId: string | null;
  title: string;
  notes: string | null;
  category: ItemCategory;
  status: ItemStatus;
  scheduledFor: string | null;
  timeWindow: string | null;
  person: string | null;
  contextLabel: string | null;
  sourceExcerpt: string | null;
  updatedAt: string;
  matchScore: number;
}

export interface DashboardData {
  topics: Topic[];
  categories: CategorySummary[];
  today: Item[];
  quick: Item[];
  doing: Item[];
  review: Item[];
  later: Item[];
  waiting: Item[];
  inbox: Item[];
  notebook: NotebookNote[];
  completedToday: number;
  totalOpen: number;
  aiEnabled: boolean;
}

export interface ExtractedItem {
  title: string;
  notes: string | null;
  category: ItemCategory;
  priority: Priority;
  durationMinutes: number | null;
  energy: Energy;
  person: string | null;
  contextLabel: string | null;
  scheduleHint:
    | "now"
    | "today"
    | "tonight"
    | "tomorrow"
    | "weekend"
    | "next_week"
    | "waiting"
    | "someday"
    | "none";
  specificTime: string | null;
  timeWindow: string | null;
  isActionable: boolean;
  confidence: number;
  needsConfirmation: boolean;
  confirmationQuestion: string | null;
}
