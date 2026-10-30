import { describe, expect, it } from "vitest";
import { mapLimited } from "./concurrency";

describe("mapLimited", () => {
  it("keeps the order of the input and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapLimited([30, 10, 20, 5, 15], 2, async (delay) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, delay));
      running -= 1;
      return delay * 2;
    });
    expect(result).toEqual([60, 20, 40, 10, 30]);
    expect(peak).toBe(2);
  });

  it("rejects with the first failure", async () => {
    await expect(mapLimited([1, 2], 2, (value) => (value === 2 ? Promise.reject(new Error("weg")) : Promise.resolve(value)))).rejects.toThrow("weg");
  });
});
