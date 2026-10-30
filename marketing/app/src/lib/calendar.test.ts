import { describe, expect, it } from "vitest";
import { isoWeek, weekStart } from "./calendar";

describe("planner calendar", () => {
  it("starts the week on Monday", () => {
    const start = weekStart(new Date(2026, 9, 25, 15));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 9, 19, 0]);
    expect(weekStart(new Date(2026, 9, 19, 0)).getDate()).toBe(19);
  });

  it("numbers calendar weeks after ISO 8601", () => {
    expect(isoWeek(new Date(2026, 9, 19))).toBe(43);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2027, 0, 4))).toBe(1);
  });
});
