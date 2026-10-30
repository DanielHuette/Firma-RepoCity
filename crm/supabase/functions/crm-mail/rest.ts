// Database and file store access with the service key: PostgREST for the schemas crm and public,
// Supabase Storage for the buckets crm-documents (CRM files) and documents (RadarAuditor files).
import { SERVICE_HEADERS, SUPABASE_URL } from "./env.ts";
import { WorkerError } from "./errors.ts";

export const CRM_BUCKET = "crm-documents";
export const RADAR_BUCKET = "documents";
const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000;

async function request<T>(path: string, init: RequestInit, headers: Record<string, string>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...SERVICE_HEADERS, "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await response.text();
  if (!response.ok) throw new WorkerError(`Datenbank ${path.split("?")[0]}: ${String(response.status)} ${text.slice(0, 300)}`);
  return (text === "" ? null : JSON.parse(text)) as T;
}

const profile = (schema: string) => ({ "Accept-Profile": schema, "Content-Profile": schema });

export function select<T>(path: string, schema = "crm"): Promise<T> {
  return request<T>(path, {}, profile(schema));
}

/** Every row of a query, fetched in pages, so the server's row limit cannot cut a list short. */
export async function selectAll<T>(path: string, schema = "crm"): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await select<T[]>(`${path}&limit=${String(PAGE_SIZE)}&offset=${String(offset)}`, schema);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return request<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) }, profile("crm"));
}

/** Inserts rows; with onConflict an existing row is left alone and not returned. */
export function insert<T = unknown>(table: string, rows: unknown, onConflict = ""): Promise<T> {
  const prefer = onConflict === "" ? "return=representation" : "return=representation,resolution=ignore-duplicates";
  const path = onConflict === "" ? table : `${table}?on_conflict=${onConflict}`;
  return request<T>(path, { method: "POST", body: JSON.stringify(rows) }, { ...profile("crm"), Prefer: prefer });
}

export function upsert(table: string, onConflict: string, row: unknown): Promise<null> {
  return request<null>(`${table}?on_conflict=${onConflict}`, { method: "POST", body: JSON.stringify(row) }, { ...profile("crm"), Prefer: "return=minimal,resolution=merge-duplicates" });
}

export function patch(table: string, filter: string, values: unknown): Promise<null> {
  return request<null>(`${table}?${filter}`, { method: "PATCH", body: JSON.stringify(values) }, { ...profile("crm"), Prefer: "return=minimal" });
}

function objectUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function storage(url: string, init: RequestInit, what: string): Promise<Response> {
  const response = await fetch(url, { ...init, headers: { ...SERVICE_HEADERS, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new WorkerError(`Speicher ${what}: ${String(response.status)} ${(await response.text()).slice(0, 200)}`);
  return response;
}

export async function upload(path: string, bytes: Uint8Array, contentType: string, bucket = CRM_BUCKET): Promise<void> {
  await storage(objectUrl(bucket, path), { method: "POST", body: bytes.slice(), headers: { "Content-Type": contentType || "application/octet-stream", "x-upsert": "true" } }, path);
}

export async function download(path: string, bucket = CRM_BUCKET): Promise<Uint8Array> {
  return new Uint8Array(await (await storage(objectUrl(bucket, path), {}, path)).arrayBuffer());
}

export async function remove(paths: string[], bucket = CRM_BUCKET): Promise<void> {
  if (paths.length === 0) return;
  await storage(`${SUPABASE_URL}/storage/v1/object/${bucket}`, { method: "DELETE", body: JSON.stringify({ prefixes: paths }), headers: { "Content-Type": "application/json" } }, paths[0]);
}

/** Full paths of the files directly inside a folder of the bucket. */
export async function list(folder: string, bucket = CRM_BUCKET): Promise<string[]> {
  const response = await storage(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST", body: JSON.stringify({ prefix: folder, limit: 1000, offset: 0 }), headers: { "Content-Type": "application/json" },
  }, folder);
  const entries = await response.json() as { name: string; id: string | null }[];
  return entries.filter((entry) => entry.id !== null).map((entry) => `${folder.replace(/\/$/, "")}/${entry.name}`);
}
