// The free slots of the audit request form as a list by day, in German time.
// Context: /api/termine answers start times in UTC; a meeting always lasts one hour. | Input:
// start times as ISO strings. | Output: days in order, each with its slots.

const ZONE = "Europe/Berlin";
const HOUR_MS = 60 * 60 * 1000;
const DAY = new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
const TIME = new Intl.DateTimeFormat("de-DE", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// en-CA formats a date as yyyy-mm-dd, which sorts and serves as a stable key.
const KEY = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Days with their one-hour slots, e.g. {key: "2026-11-03", label: "Dienstag, 03.11.2026", slots: [...]}. */
export function groupSlots(values) {
  const starts = [...new Set(values.map((value) => Date.parse(value)).filter((time) => !Number.isNaN(time)))].sort((a, b) => a - b);
  const days = new Map();
  for (const start of starts) {
    const key = KEY.format(start);
    if (!days.has(key)) days.set(key, { key, label: DAY.format(start), slots: [] });
    days.get(key).slots.push({
      value: new Date(start).toISOString(),
      time: `${TIME.format(start)}–${TIME.format(start + HOUR_MS)} Uhr`,
    });
  }
  return [...days.values()];
}
