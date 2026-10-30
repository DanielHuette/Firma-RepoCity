// German formatting of money and time.
const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const DATE_TIME = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function euro(amount: number): string {
  return EURO.format(amount);
}

export function time(value: string): string {
  return TIME.format(new Date(value));
}

export function dateTime(value: string): string {
  return DATE_TIME.format(new Date(value));
}

function dayKey(value: Date): string {
  return `${String(value.getFullYear())}-${String(value.getMonth())}-${String(value.getDate())}`;
}

/** Heading of a day in the feed: "Heute", "Gestern" or the weekday with date. */
export function dayLabel(value: string, now = new Date()): string {
  const day = new Date(value);
  if (dayKey(day) === dayKey(now)) return "Heute";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(day) === dayKey(yesterday)) return "Gestern";
  return DAY.format(day);
}
