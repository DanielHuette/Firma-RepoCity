// Repeats an unreliable call, such as saving over a weak mobile connection, with a pause before each
// new try; the error of the last try is the one that counts.
const pause = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

export interface RetryOptions {
  /** Whether a failure is worth another try; a refusal is not. */
  retryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Runs the task once and once more after each of the waits (milliseconds) while it fails retryably. */
export async function retry<T>(task: () => Promise<T>, waits: number[], { retryable = () => true, sleep = pause }: RetryOptions = {}): Promise<T> {
  for (const wait of waits) {
    try {
      return await task();
    } catch (error) {
      if (!retryable(error)) throw error;
      await sleep(wait);
    }
  }
  return task();
}
