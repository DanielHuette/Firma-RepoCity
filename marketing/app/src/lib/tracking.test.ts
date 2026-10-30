import { describe, expect, it } from "vitest";
import type { Channel } from "../api/types";
import { isOwnSite, markLinks, markUrl, markersFor } from "./tracking";

// Same cases as tests/test_tracking.py, so the copy button marks exactly like a campaign push.
const LINKEDIN = { source: "linkedin", medium: "social", campaign: "probe", content: "kleine-betriebe" };
const QUERY = "utm_source=linkedin&utm_medium=social&utm_campaign=probe&utm_content=kleine-betriebe";

describe("markersFor", () => {
  it.each<[Channel, string]>([
    ["linkedin", "social"], ["x", "social"], ["xing", "social"], ["instagram", "social"], ["facebook", "social"],
    ["threads", "social"], ["youtube", "social"], ["tiktok", "social"], ["reddit", "social"], ["forum", "social"],
    ["presse", "social"], ["newsletter", "email"],
  ])("gives %s its channel as source and %s as medium", (channel, medium) => {
    expect(markersFor(channel, "probe", "kleine-betriebe")).toEqual({ source: channel, medium, campaign: "probe", content: "kleine-betriebe" });
  });

  it("leaves blog posts unmarked: they are pages of an own site", () => {
    expect(markersFor("blog", "probe", "x")).toBeNull();
  });

  it("leaves out a campaign the CRM cannot keep", () => {
    expect(markersFor("linkedin", "a".repeat(101), "x")?.campaign).toBe("");
    expect(markersFor("linkedin", "a".repeat(100), "x")?.campaign).toBe("a".repeat(100));
  });
});

describe("isOwnSite", () => {
  it.each(["https://speedofthespirit.dev/", "https://radarauditor.speedofthespirit.dev/blog/x/", "https://RepoCity.SpeedOfTheSpirit.dev"])(
    "knows %s", (url) => { expect(isOwnSite(url)).toBe(true); },
  );
  it.each([
    "http://speedofthespirit.dev/", "https://evilspeedofthespirit.dev/", "https://speedofthespirit.dev.example.com/",
    "https://speedofthespirit.dev@example.com/", "https://www.linkedin.com/in/danielhuette", "https://[::1/",
  ])("refuses %s", (url) => { expect(isOwnSite(url)).toBe(false); });
});

describe("markUrl", () => {
  it("adds the markers and keeps other parameters and the fragment", () => {
    expect(markUrl("https://radarauditor.speedofthespirit.dev/blog/x/", LINKEDIN)).toBe(`https://radarauditor.speedofthespirit.dev/blog/x/?${QUERY}`);
    expect(markUrl("https://agenticmarketing.speedofthespirit.dev/?lang=en#benchmarks", LINKEDIN))
      .toBe(`https://agenticmarketing.speedofthespirit.dev/?lang=en&${QUERY}#benchmarks`);
    expect(markUrl("https://repocity.speedofthespirit.dev/#crm", LINKEDIN)).toBe(`https://repocity.speedofthespirit.dev/?${QUERY}#crm`);
    expect(markUrl("https://speedofthespirit.dev/?", LINKEDIN)).toBe(`https://speedofthespirit.dev/?${QUERY}`);
  });

  it.each(["https://speedofthespirit.dev/?utm_source=google&utm_medium=maps", "https://speedofthespirit.dev/?a=1&UTM_TERM=x",
    "https://www.linkedin.com/in/danielhuette"])("leaves %s as it is", (url) => { expect(markUrl(url, LINKEDIN)).toBe(url); });

  it("leaves out an empty campaign", () => {
    expect(markUrl("https://speedofthespirit.dev/", { ...LINKEDIN, campaign: "" }))
      .toBe("https://speedofthespirit.dev/?utm_source=linkedin&utm_medium=social&utm_content=kleine-betriebe");
  });
});

describe("markLinks", () => {
  it("marks links in a text without their punctuation", () => {
    const text = "Mehr dazu: https://radarauditor.speedofthespirit.dev/blog/x/. Oder (https://speedofthespirit.dev/de/), sonst https://www.linkedin.com/in/a!";
    expect(markLinks(text, LINKEDIN)).toBe(
      `Mehr dazu: https://radarauditor.speedofthespirit.dev/blog/x/?${QUERY}. Oder (https://speedofthespirit.dev/de/?${QUERY}), sonst https://www.linkedin.com/in/a!`,
    );
  });

  it("keeps German quotes, guillemets and an ellipsis outside the link", () => {
    expect(markLinks("Sie fragte: „https://speedofthespirit.dev/de/“ oder »https://speedofthespirit.dev/a«…", LINKEDIN))
      .toBe(`Sie fragte: „https://speedofthespirit.dev/de/?${QUERY}“ oder »https://speedofthespirit.dev/a?${QUERY}«…`);
  });

  it("marks Markdown links and links in angle brackets", () => {
    expect(markLinks("[Blog](https://speedofthespirit.dev/blog/) und <https://speedofthespirit.dev/a>", LINKEDIN))
      .toBe(`[Blog](https://speedofthespirit.dev/blog/?${QUERY}) und <https://speedofthespirit.dev/a?${QUERY}>`);
  });

  it("keeps balanced brackets inside a link and marks a link at the end of a line", () => {
    expect(markLinks("https://speedofthespirit.dev/a_(b)", LINKEDIN)).toBe(`https://speedofthespirit.dev/a_(b)?${QUERY}`);
    expect(markLinks("Hier:\nhttps://speedofthespirit.dev/\n#Münster", LINKEDIN)).toBe(`Hier:\nhttps://speedofthespirit.dev/?${QUERY}\n#Münster`);
  });

  it("changes nothing without markers or a second time", () => {
    expect(markLinks("Siehe https://speedofthespirit.dev/.", null)).toBe("Siehe https://speedofthespirit.dev/.");
    const once = markLinks("https://speedofthespirit.dev/a", LINKEDIN);
    expect(markLinks(once, LINKEDIN)).toBe(once);
  });
});
