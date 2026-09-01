import type { Priority } from "@/lib/types";

export type ReviewPlan = { reviewAt: string; intervalDays: number };
const intervals = [1, 3, 7, 14, 30] as const;

function addDays(now: Date, days: number) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function initialReviewPlan(priority: Priority, now = new Date()): ReviewPlan {
  if (priority === "urgent") return { reviewAt: now.toISOString(), intervalDays: 1 };
  const intervalDays = priority === "high" ? 1 : priority === "low" ? 7 : 3;
  return { reviewAt: addDays(now, intervalDays), intervalDays };
}

export function nextReviewPlan(currentInterval: number | null, now = new Date()): ReviewPlan {
  const current = currentInterval && currentInterval > 0 ? currentInterval : 1;
  const intervalDays = intervals.find((value) => value > current) || intervals.at(-1)!;
  return { reviewAt: addDays(now, intervalDays), intervalDays };
}
