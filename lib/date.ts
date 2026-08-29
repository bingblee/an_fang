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
