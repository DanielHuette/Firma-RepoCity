import { describe, expect, it } from "vitest";
import { retry } from "./retry";

function recorder(): { waited: number[]; sleep: (ms: number) => Promise<void> } {
  const waited: number[] = [];
  return { waited, sleep: (ms) => { waited.push(ms); return Promise.resolve(); } };
}

describe("retry", () => {
  it("tries again after each wait until the task succeeds", async () => {
    const { waited, sleep } = recorder();
    let attempts = 0;
    const task = () => {
      attempts += 1;
      return attempts < 3 ? Promise.reject(new Error(`Versuch ${String(attempts)}`)) : Promise.resolve("gespeichert");
    };

    expect(await retry(task, [1000, 3000], { sleep })).toBe("gespeichert");
    expect(attempts).toBe(3);
    expect(waited).toEqual([1000, 3000]);
  });

  it("gives up after the last try with the last error", async () => {
    const { sleep } = recorder();
    let attempts = 0;
    const task = () => { attempts += 1; return Promise.reject(new Error(`Versuch ${String(attempts)}`)); };

    await expect(retry(task, [1, 1], { sleep })).rejects.toThrow("Versuch 3");
    expect(attempts).toBe(3);
  });

  it("stops at once on a failure that is not worth another try", async () => {
    const { waited, sleep } = recorder();
    let attempts = 0;
    const task = () => { attempts += 1; return Promise.reject(new Error("abgelehnt")); };

    await expect(retry(task, [1, 1], { sleep, retryable: () => false })).rejects.toThrow("abgelehnt");
    expect(attempts).toBe(1);
    expect(waited).toEqual([]);
  });

  it("does not wait when the first try works", async () => {
    const { waited, sleep } = recorder();

    await retry(() => Promise.resolve("ok"), [1000], { sleep });

    expect(waited).toEqual([]);
  });
});
