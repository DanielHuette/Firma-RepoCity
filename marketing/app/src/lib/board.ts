// How posts are grouped on the board and when a campaign may start.
import type { Campaign, Post } from "../api/types";

export type Column = "review" | "planned" | "due" | "published" | "rejected";

export const COLUMNS: { key: Column; title: string; hint: string }[] = [
  { key: "review", title: "Zur Freigabe", hint: "Wartet auf deine Entscheidung" },
  { key: "planned", title: "Freigegeben", hint: "Geht zum geplanten Termin raus" },
  { key: "due", title: "Jetzt posten", hint: "Von Hand posten, dann markieren" },
  { key: "published", title: "Veröffentlicht", hint: "Live und gemessen" },
  { key: "rejected", title: "Abgelehnt", hint: "Mit Begründung zurück" },
];

export function columnOf(post: Post, now: Date): Column {
  switch (post.status) {
    case "published":
      return "published";
    case "rejected":
      return "rejected";
    case "approved":
      {
        const moment = post.scheduled_for ?? post.planned_for;
        if (moment !== null && new Date(moment) <= now) return "due";
      }
      return "planned";
    default:
      return "review";
  }
}

export function groupPosts(posts: readonly Post[], now: Date): Record<Column, Post[]> {
  const groups: Record<Column, Post[]> = { review: [], planned: [], due: [], published: [], rejected: [] };
  for (const post of posts) groups[columnOf(post, now)].push(post);
  return groups;
}

export interface StartCheck {
  allowed: boolean;
  reasons: string[];
  approved: number;
  waiting: number;
}

/** Whether the start button may be pressed, and what the operator should know first. */
export function startCheck(campaign: Campaign, posts: readonly Post[]): StartCheck {
  const approved = posts.filter((post) => post.status === "approved").length;
  const waiting = posts.filter((post) => post.status === "review" || post.status === "draft").length;
  const reasons: string[] = [];
  if (campaign.status !== "ready" && campaign.status !== "paused") reasons.push("Die Kampagne ist nicht startklar.");
  if (approved === 0) reasons.push("Noch kein Beitrag ist freigegeben.");
  return { allowed: reasons.length === 0, reasons, approved, waiting };
}

/** The moment a post goes out, the same rule the database applies at the start. */
export function plannedMoment(campaign: Campaign, post: Post, start: Date): Date {
  if (post.scheduled_for !== null) return new Date(post.scheduled_for);
  if (post.planned_for !== null) return new Date(post.planned_for);
  const base = campaign.started_at === null ? start : new Date(campaign.started_at);
  const [hours, minutes] = campaign.publish_time.split(":").map(Number);
  const berlinDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(base);
  const target = new Date(`${berlinDay}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() + post.day_offset);
  target.setUTCHours(hours ?? 9, minutes ?? 0);
  const offset = berlinOffsetMinutes(target);
  const moment = new Date(target.getTime() - offset * 60_000);
  return moment < start ? start : moment;
}

function berlinOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" }).formatToParts(at);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+1";
  const match = /GMT([+-]\d+)(?::(\d+))?/.exec(name);
  if (match === null) return 60;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + Math.sign(hours) * minutes;
}
