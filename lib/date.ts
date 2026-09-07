import type { ExtractedItem } from "@/lib/types";

function atTime(date: Date, hours: number, minutes = 0) {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function resolveLocalSpecificTime(text: string, existingSchedule: string | null = null, now = new Date()) {
  const time = text.match(/(上午|下午|晚上|中午|凌晨|早上|早晨)?\s*(\d{1,2})\s*([:：点])\s*(\d{1,2}|半)?/);
  if (!time) return null;
  let hour = Number(time[2]);
  const minute = time[4] === "半" ? 30 : Number(time[4] || 0);
  if (hour > 23 || minute > 59) return null;
  if (/下午|晚上|中午/.test(time[1] || "") && hour < 12) hour += 12;
  if (time[1] === "凌晨" && hour === 12) hour = 0;

  // Explicit dates override a merge target's date; a clock-only correction keeps it.
  let anchor = existingSchedule ? new Date(existingSchedule) : new Date(now);
  const relative = text.match(/大后天|后天|明天|明日|明早|今天|今日|今晚/);
  const weekday = text.match(/(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/);
  const week = text.match(/(下下|下|本|这)周(?:末)?|周末/);
  if (relative) {
    const days = /大后天/.test(relative[0]) ? 3 : /后天/.test(relative[0]) ? 2 : /明/.test(relative[0]) ? 1 : 0;
    anchor = addDays(now, days);
  } else if (weekday || week) {
    const currentDay = (now.getDay() + 6) % 7;
    const targetDay = weekday ? Math.min("一二三四五六日天".indexOf(weekday[2]), 6) : /周末/.test(week![0]) ? 5 : 0;
    const prefix = weekday?.[1] || week?.[1];
    const offset = prefix === "下下" ? 14 : prefix === "下" ? 7 : 0;
    const days = prefix ? offset + targetDay - currentDay : (targetDay - currentDay + 7) % 7;
    anchor = addDays(now, days);
  }
  return atTime(anchor, hour, minute).toISOString();
}

function preferredTime(extracted: ExtractedItem, fallbackHour: number, fallbackMinute = 0) {
  const context = `${extracted.timeWindow || ""} ${extracted.contextLabel || ""}`;
  if (/下班后/.test(context)) return { hour: 18, minute: 30 };
  if (/回家后/.test(context)) return { hour: 20, minute: 0 };
  if (/睡前/.test(context)) return { hour: 21, minute: 30 };
  if (/晚上|今晚/.test(context)) return { hour: 20, minute: 30 };
  if (/早上|明早|上午/.test(context)) return { hour: 9, minute: 0 };
  if (/中午|午休/.test(context)) return { hour: 12, minute: 30 };
  if (/下午/.test(context)) return { hour: 15, minute: 0 };
  return { hour: fallbackHour, minute: fallbackMinute };
}

export function resolveSchedule(
  extracted: ExtractedItem,
  now = new Date()
): { status: "scheduled" | "waiting" | "later"; scheduledFor: string | null } {
  if (extracted.specificTime) {
    const parsed = new Date(extracted.specificTime);
    if (!Number.isNaN(parsed.getTime())) {
      return { status: "scheduled", scheduledFor: parsed.toISOString() };
    }
  }

  switch (extracted.scheduleHint) {
    case "now":
      return { status: "scheduled", scheduledFor: now.toISOString() };
    case "today": {
      const preferred = preferredTime(extracted, 17, 30);
      const candidate = atTime(now, preferred.hour, preferred.minute);
      return {
        status: "scheduled",
        scheduledFor: (candidate > now ? candidate : now).toISOString()
      };
    }
    case "tonight": {
      const preferred = preferredTime(extracted, 20, 30);
      return {
        status: "scheduled",
        scheduledFor: atTime(now, preferred.hour, preferred.minute).toISOString()
      };
    }
    case "tomorrow": {
      const preferred = preferredTime(extracted, 9, 30);
      return {
        status: "scheduled",
        scheduledFor: atTime(addDays(now, 1), preferred.hour, preferred.minute).toISOString()
      };
    }
    case "weekend": {
      const day = now.getDay();
      const daysUntilSaturday = day === 6 ? 0 : (6 - day + 7) % 7;
      return {
        status: "scheduled",
        scheduledFor: atTime(addDays(now, daysUntilSaturday), 10).toISOString()
      };
    }
    case "next_week": {
      const day = now.getDay();
      const daysUntilMonday = day === 0 ? 1 : 8 - day;
      return {
        status: "scheduled",
        scheduledFor: atTime(addDays(now, daysUntilMonday), 9, 30).toISOString()
      };
    }
    case "waiting":
      return { status: "waiting", scheduledFor: null };
    case "someday":
    case "none":
    default:
      return { status: "later", scheduledFor: null };
  }
}

export function snoozeDate(preset: string, now = new Date()) {
  switch (preset) {
    case "hour":
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case "tonight":
      return atTime(now, 20, 30).toISOString();
    case "tomorrow":
      return atTime(addDays(now, 1), 9, 30).toISOString();
    case "weekend": {
      const day = now.getDay();
      const offset = day === 6 ? 7 : (6 - day + 7) % 7;
      return atTime(addDays(now, offset), 10).toISOString();
    }
    default: {
      const parsed = new Date(preset);
      return Number.isNaN(parsed.getTime())
        ? addDays(now, 1).toISOString()
        : parsed.toISOString();
    }
  }
}
