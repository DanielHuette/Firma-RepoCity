// Error type of the mail worker: its messages are German, they reach Daniel in the app.

export class WorkerError extends Error {
  override name = "WorkerError";
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
