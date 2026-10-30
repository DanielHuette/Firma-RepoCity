import { describe, expect, it } from "vitest";
import { periodProblem, presetPeriod, reportTotals } from "./period";

describe("presetPeriod", () => {
  it("covers this month, this year and the last twelve months up to today", () => {
    expect(presetPeriod("monat", "2026-10-30")).toEqual({ from: "2026-10-01", to: "2026-10-30" });
    expect(presetPeriod("jahr", "2026-10-30")).toEqual({ from: "2026-01-01", to: "2026-10-30" });
    expect(presetPeriod("zwoelf", "2026-10-30")).toEqual({ from: "2025-10-31", to: "2026-10-30" });
    expect(presetPeriod("zwoelf", "2028-02-29")).toEqual({ from: "2027-03-01", to: "2028-02-29" });
  });
});

describe("periodProblem", () => {
  it("needs two days in order", () => {
    expect(periodProblem({ from: "2026-10-01", to: "2026-10-30" })).toBeNull();
    expect(periodProblem({ from: "2026-10-01", to: "2026-10-01" })).toBeNull();
    expect(periodProblem({ from: "", to: "2026-10-30" })).toBe("Bitte Beginn und Ende des Zeitraums angeben.");
    expect(periodProblem({ from: "2026-10-31", to: "2026-10-30" })).toBe("Der Beginn muss vor dem Ende liegen.");
  });
});

describe("reportTotals", () => {
  it("adds up every channel", () => {
    expect(reportTotals([
      { channel: "linkedin", label: "LinkedIn", inquiries: 3, customers: 2, revenue: 1200.5 },
      { channel: "unknown", label: "Unbekannt", inquiries: 1, customers: 0, revenue: 99.5 },
    ])).toEqual({ inquiries: 4, customers: 2, revenue: 1300 });
    expect(reportTotals([])).toEqual({ inquiries: 0, customers: 0, revenue: 0 });
  });
});
