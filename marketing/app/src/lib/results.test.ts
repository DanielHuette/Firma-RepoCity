import { describe, expect, it } from "vitest";
import type { Metric } from "../api/types";
import { byDay, byPost, isSimulated, sum } from "./results";

function metric(post: string, day: string, views: number, source: Metric["source"] = "counter"): Metric {
  return { id: `${post}${day}`, post_id: post, day, views, clicks: 1, leads: 0, source };
}

describe("results", () => {
  const rows = [metric("a", "2026-10-18", 10), metric("b", "2026-10-18", 5), metric("a", "2026-10-20", 2)];

  it("sums everything", () => {
    expect(sum(rows)).toEqual({ views: 17, clicks: 3, leads: 0 });
  });

  it("sums per post", () => {
    expect(byPost(rows).get("a")).toEqual({ views: 12, clicks: 2, leads: 0 });
  });

  it("fills the days without results", () => {
    expect(byDay(rows).map((row) => [row.day, row.views])).toEqual([
      ["2026-10-18", 15],
      ["2026-10-19", 0],
      ["2026-10-20", 2],
    ]);
  });

  it("notices simulated rows", () => {
    expect(isSimulated(rows)).toBe(false);
    expect(isSimulated([metric("a", "2026-10-18", 1, "simulated")])).toBe(true);
  });
});
