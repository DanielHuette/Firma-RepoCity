// Small building blocks shared by the pages.
import type { ComponentChildren } from "preact";
import type { CampaignStatus, PostStatus, Verdict } from "../api/types";
import { CAMPAIGN_STATUS, POST_STATUS, VERDICT } from "../lib/format";

export function Loading({ label = "Lädt …" }: { label?: string }) {
  return <p class="muted" role="status">{label}</p>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (message === null) return null;
  return <p class="note note--bad" role="alert">{message}</p>;
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <p class="muted small">{children}</p>;
}

const CAMPAIGN_TONE: Record<CampaignStatus, string> = {
  draft: "",
  ready: "badge--gold",
  running: "badge--good",
  paused: "badge--bad",
  done: "badge--ink",
};

export function CampaignBadge({ status }: { status: CampaignStatus }) {
  return <span class={`badge ${CAMPAIGN_TONE[status]}`}>{CAMPAIGN_STATUS[status]}</span>;
}

const POST_TONE: Record<PostStatus, string> = {
  draft: "",
  review: "badge--gold",
  approved: "badge--good",
  published: "badge--ink",
  rejected: "badge--bad",
};

export function PostBadge({ status }: { status: PostStatus }) {
  return <span class={`badge ${POST_TONE[status]}`}>{POST_STATUS[status]}</span>;
}

const VERDICT_TONE: Record<Verdict, string> = {
  supported: "badge--good",
  partial: "badge--gold",
  unsupported: "badge--bad",
  unreachable: "badge--bad",
  "not-checked": "",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span class={`badge ${VERDICT_TONE[verdict]}`}>{VERDICT[verdict]}</span>;
}

export function ExampleBadge() {
  return <span class="badge badge--gold">Beispiel · fiktiv</span>;
}

export function Kpi({ label, value, goal }: { label: string; value: string; goal?: { done: number; target: number } }) {
  const share = goal === undefined || goal.target <= 0 ? null : Math.round((100 * goal.done) / goal.target);
  return (
    <div class="kpi">
      <div class="kpi__label">{label}</div>
      <div class="kpi__value num">{value}</div>
      {share !== null && goal !== undefined && (
        <>
          <div class="bar" aria-hidden="true">
            <span style={{ width: `${String(Math.min(100, share))}%` }} />
          </div>
          <div class="small muted num">
            {share} % von {goal.target.toLocaleString("de-DE")}
          </div>
        </>
      )}
    </div>
  );
}
