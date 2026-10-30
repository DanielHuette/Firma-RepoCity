import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders the tables of a report", () => {
    expect(renderMarkdown("| a | b |\n|---|---:|\n| 1 | 2 |\n")).toContain("<table>");
  });

  it("never passes raw HTML through", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
  });
});
