// Rows of the `marketing` schema as the app reads them.
export type CampaignStatus = "draft" | "ready" | "running" | "paused" | "done";
export type PostStatus = "draft" | "review" | "approved" | "published" | "rejected";
export type Channel =
  | "blog" | "linkedin" | "x" | "xing" | "instagram" | "facebook" | "threads"
  | "youtube" | "tiktok" | "reddit" | "forum" | "presse" | "newsletter";
export type Verdict = "supported" | "partial" | "unsupported" | "unreachable" | "not-checked";
export type MetricSource = "cloudflare" | "counter" | "manual" | "simulated";

export interface Kpi {
  views?: number;
  clicks?: number;
  leads?: number;
}

export interface Campaign {
  id: string;
  slug: string;
  title: string;
  product: string;
  goal: string;
  audience: string;
  target: string;
  status: CampaignStatus;
  is_example: boolean;
  duration_days: number;
  publish_time: string;
  kpi: Kpi;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface CampaignOverview {
  id: string;
  slug: string;
  title: string;
  status: CampaignStatus;
  is_example: boolean;
  started_at: string | null;
  in_review: number;
  approved: number;
  published: number;
  posts: number;
  views: number;
  clicks: number;
  leads: number;
}

export interface Finding {
  id: string;
  campaign_id: string;
  key: string;
  statement: string;
  detail: string;
  figures: string[];
  source_url: string | null;
  source_publisher: string;
  source_title: string;
  source_published: string | null;
  verdict: Verdict;
  evidence: string | null;
  checked_on: string | null;
}

export interface Post {
  id: string;
  campaign_id: string;
  channel: Channel;
  slug: string;
  title: string;
  summary: string;
  body_md: string;
  day_offset: number;
  status: PostStatus;
  unbacked_figures: string[];
  free_figures: string[];
  scheduled_for: string | null;
  planned_for: string | null;
  published_at: string | null;
  url: string | null;
  review_note: string | null;
  version: number;
  updated_at: string;
}

export interface PostWithFindings extends Post {
  post_findings: { findings: Finding }[];
}

export interface CampaignEvent {
  id: string;
  campaign_id: string;
  post_id: string | null;
  kind: string;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface Metric {
  id: string;
  post_id: string;
  day: string;
  views: number;
  clicks: number;
  leads: number;
  source: MetricSource;
}

export interface Report {
  id: string;
  campaign_id: string;
  period_end: string;
  body_md: string;
  created_at: string;
}

/** One post on the calendar; `moment` is when it went, goes or is planned to go out. */
export interface PlanRow {
  id: string;
  campaign_id: string;
  campaign_slug: string;
  campaign_title: string;
  channel: Channel;
  title: string;
  summary: string;
  status: PostStatus;
  unbacked_figures: string[];
  url: string | null;
  planned_for: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  moment: string | null;
}
