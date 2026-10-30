import { describe, expect, it } from "vitest";
import type { Campaign, Post } from "../api/types";
import { columnOf, groupPosts, plannedMoment, startCheck } from "./board";

const NOW = new Date("2026-10-20T10:00:00Z");

function post(overrides: Partial<Post>): Post {
  return {
    id: "p",
    campaign_id: "c",
    channel: "blog",
    slug: "beitrag",
    title: "Beitrag",
    summary: "",
    body_md: "",
    day_offset: 0,
    status: "review",
    unbacked_figures: [],
    free_figures: [],
    scheduled_for: null,
    planned_for: null,
    published_at: null,
    url: null,
    review_note: null,
    version: 1,
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function campaign(overrides: Partial<Campaign>): Campaign {
  return {
    id: "c",
    slug: "probe",
    title: "Probe",
    product: "P",
    goal: "Ziel",
    audience: "Zielgruppe",
    target: "beispiel",
    status: "ready",
    is_example: false,
    duration_days: 28,
    publish_time: "09:00:00",
    kpi: {},
    started_at: null,
    ended_at: null,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("board", () => {
  it("puts a planned X post into the posting column once its moment has come", () => {
    expect(columnOf(post({ channel: "x", status: "approved", planned_for: "2026-10-20T09:00:00Z" }), NOW)).toBe("due");
    expect(columnOf(post({ channel: "x", status: "approved", planned_for: "2026-10-20T11:00:00Z" }), NOW)).toBe("planned");
    expect(columnOf(post({ channel: "blog", status: "approved", planned_for: "2026-10-20T09:00:00Z" }), NOW)).toBe("due");
  });

  it("puts a due LinkedIn post into the posting column", () => {
    const due = post({ channel: "linkedin", status: "approved", scheduled_for: "2026-10-20T07:00:00Z" });
    expect(columnOf(due, NOW)).toBe("due");
    expect(columnOf({ ...due, scheduled_for: "2026-10-21T07:00:00Z" }, NOW)).toBe("planned");
  });

  it("keeps an approved post planned until its moment", () => {
    expect(columnOf(post({ status: "approved", scheduled_for: "2026-10-20T11:00:00Z" }), NOW)).toBe("planned");
  });

  it("groups every post exactly once", () => {
    const groups = groupPosts([post({}), post({ status: "published" }), post({ status: "rejected" })], NOW);
    expect([groups.review.length, groups.published.length, groups.rejected.length]).toEqual([1, 1, 1]);
  });

  it("allows a start only with an approved post", () => {
    expect(startCheck(campaign({}), [post({})]).allowed).toBe(false);
    const check = startCheck(campaign({}), [post({ status: "approved" }), post({})]);
    expect(check).toMatchObject({ allowed: true, approved: 1, waiting: 1 });
    expect(startCheck(campaign({ status: "running" }), [post({ status: "approved" })]).allowed).toBe(false);
  });

  it("plans a post at its day and the campaign's time, Berlin time", () => {
    const start = new Date("2026-10-20T06:00:00Z");
    expect(plannedMoment(campaign({}), post({ day_offset: 2 }), start).toISOString()).toBe("2026-10-22T07:00:00.000Z");
  });

  it("never plans into the past", () => {
    expect(plannedMoment(campaign({}), post({ day_offset: 0 }), NOW).toISOString()).toBe(NOW.toISOString());
  });
});
