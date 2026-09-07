export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ANFANG_BUILD !== "1") {
    const { getDb } = await import("@/lib/db");
    getDb();
    const { startReminderScheduler } = await import("@/lib/reminder-scheduler");
    startReminderScheduler();
  }
}
