// Turns Supabase results into data or a QueryError that names the action that failed.
import type { PostgrestError } from "@supabase/supabase-js";
import { QueryError } from "../lib/errors";

interface Result<T> {
  data: T | null;
  error: PostgrestError | null;
}

export function unwrap<T>(action: string, result: Result<T>): T {
  if (result.error !== null) throw new QueryError(action, result.error.message, result.error.code);
  if (result.data === null) throw new QueryError(action, "keine Daten", null);
  return result.data;
}

export function check(action: string, result: { error: PostgrestError | null }): void {
  if (result.error !== null) throw new QueryError(action, result.error.message, result.error.code);
}
