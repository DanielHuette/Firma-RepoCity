// Calendar arithmetic of the planner, in the local time of the browser (Münster).
const DAY_MS = 86_400_000;

/** Monday 00:00 local time of the week that contains the day. */
export function weekStart(day: Date): Date {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** Calendar week after ISO 8601, as printed in German calendars. */
export function isoWeek(day: Date): number {
  const date = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

export function addDays(day: Date, count: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + count);
  return next;
}

export function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
