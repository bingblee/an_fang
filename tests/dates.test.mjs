import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLocalSpecificTime, resolveSchedule } from "../lib/date.ts";

const monday = new Date(2026, 8, 7, 14);
const iso = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();

test("local clock extraction respects explicit weekdays and relative dates", () => {
  for (const [text, expected] of [
    ["下周一上午9点检查设备", iso(14, 9)],
    ["下星期三下午3:30开会", iso(16, 15, 30)],
    ["下下周日上午9点出发", iso(27, 9)],
    ["周日晚上8点打电话", iso(13, 20)],
    ["星期天上午10点见面", iso(13, 10)],
    ["周末上午10点采购", iso(12, 10)],
    ["下周末下午3点半集合", iso(19, 15, 30)],
    ["明早9点检查清单", iso(8, 9)],
    ["后天下午2点出发", iso(9, 14)],
    ["大后天凌晨12:30出发", iso(10, 0, 30)],
    ["今天上午9点复查", iso(7, 9)]
  ]) {
    const specificTime = resolveLocalSpecificTime(text, null, monday);
    assert.equal(specificTime, expected, text);
    assert.equal(resolveSchedule({ specificTime, scheduleHint: "next_week" }, monday).scheduledFor, expected);
  }
});

test("local corrections preserve the existing date only when no new date is given", () => {
  const existing = iso(21, 8);
  assert.equal(resolveLocalSpecificTime("时间改到下午3点", existing, monday), iso(21, 15));
  assert.equal(resolveLocalSpecificTime("周先生的时间改到下午3点", existing, monday), iso(21, 15));
  assert.equal(resolveLocalSpecificTime("改到明天下午3点", existing, monday), iso(8, 15));
  assert.equal(resolveLocalSpecificTime("改到下周一上午9点", existing, monday), iso(14, 9));
  assert.equal(resolveLocalSpecificTime("今天晚上8点", existing, monday), iso(7, 20));
});

test("local weekday dates cross month/year boundaries and invalid clocks do not roll over", () => {
  assert.equal(resolveLocalSpecificTime("下周一上午9点", null, new Date(2026, 11, 31, 12)),
    new Date(2027, 0, 4, 9).toISOString());
  for (const text of ["25:00开会", "9:99见面", "明天看看"]) {
    assert.equal(resolveLocalSpecificTime(text, null, monday), null);
  }
});
