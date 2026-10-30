// German labels and number and date formats used across the app.
import type { CampaignStatus, Channel, PostStatus, Verdict } from "../api/types";

const TIME_ZONE = "Europe/Berlin";
const number = new Intl.NumberFormat("de-DE");
const day = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, day: "numeric", month: "long", year: "numeric" });
const moment = new Intl.DateTimeFormat("de-DE", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatNumber(value: number): string {
  return number.format(value);
}

export function formatDay(iso: string): string {
  return day.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
}

export function formatMoment(iso: string): string {
  return `${moment.format(new Date(iso))} Uhr`;
}

export function percent(done: number, goal: number | undefined): number | null {
  if (goal === undefined || goal <= 0) return null;
  return Math.round((100 * done) / goal);
}

export const CAMPAIGN_STATUS: Record<CampaignStatus, string> = {
  draft: "Entwurf",
  ready: "Startklar",
  running: "Läuft",
  paused: "Pausiert",
  done: "Abgeschlossen",
};

export const POST_STATUS: Record<PostStatus, string> = {
  draft: "Entwurf",
  review: "Zur Freigabe",
  approved: "Freigegeben",
  published: "Veröffentlicht",
  rejected: "Abgelehnt",
};

export const CHANNEL: Record<Channel, string> = {
  blog: "Blog",
  linkedin: "LinkedIn",
  x: "X",
  xing: "XING",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  youtube: "YouTube",
  tiktok: "TikTok",
  reddit: "Reddit",
  forum: "Forum",
  presse: "Presse",
  newsletter: "Newsletter",
};

export const VERDICT: Record<Verdict, string> = {
  supported: "Belegt",
  partial: "Teilweise belegt",
  unsupported: "Nicht belegt",
  unreachable: "Quelle nicht erreichbar",
  "not-checked": "Nicht geprüft",
};

export const EVENT: Record<string, string> = {
  pushed: "Aus dem Arbeitsbereich übernommen",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  reopened: "Zurück in die Prüfung",
  edited: "Bearbeitet",
  started: "Kampagne gestartet",
  paused: "Kampagne pausiert",
  published: "Im Blog veröffentlicht",
  posted: "Von Hand gepostet",
  created: "Im Planer angelegt",
  moved: "Termin verschoben",
  result: "Ergebnis eingetragen",
  reported: "Wochenbericht erstellt",
  finished: "Kampagne abgeschlossen",
};
