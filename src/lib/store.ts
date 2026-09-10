import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RecentEntry, RunRecord } from "./types";

const RECENT_LIMIT = 48;

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

const localRoot = path.join(process.cwd(), ".data");

async function localRead(file: string): Promise<string | null> {
  try {
    return await readFile(path.join(localRoot, file), "utf8");
  } catch {
    return null;
  }
}

async function localWrite(file: string, content: string): Promise<void> {
  const target = path.join(localRoot, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function blobRead(pathname: string, fresh = false): Promise<string | null> {
  const { head } = await import("@vercel/blob");
  let url: string;
  try {
    const info = await head(pathname);
    url = info.url;
  } catch {
    return null;
  }
  const response = await fetch(fresh ? `${url}?t=${Date.now()}` : url, { cache: "no-store" });
  if (!response.ok) return null;
  return response.text();
}

async function blobWrite(pathname: string, content: string): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(pathname, content, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

const memoryRuns = new Map<string, RunRecord>();

export async function saveRun(record: RunRecord): Promise<void> {
  const json = JSON.stringify(record);
  memoryRuns.set(record.id, record);
  if (blobEnabled()) await blobWrite(`runs/${record.id}.json`, json);
  else await localWrite(`runs/${record.id}.json`, json);
}

export async function loadRun(id: string): Promise<RunRecord | null> {
  if (!/^[a-z0-9-]{6,40}$/i.test(id)) return null;
  const cached = memoryRuns.get(id);
  if (cached) return cached;
  const text = blobEnabled() ? await blobRead(`runs/${id}.json`) : await localRead(`runs/${id}.json`);
  if (!text) return null;
  try {
    const record = JSON.parse(text) as RunRecord;
    memoryRuns.set(id, record);
    return record;
  } catch {
    return null;
  }
}

export async function listRecent(): Promise<RecentEntry[]> {
  const text = blobEnabled() ? await blobRead("index/recent.json", true) : await localRead("recent.json");
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as RecentEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function pushRecent(entry: RecentEntry): Promise<void> {
  const current = await listRecent();
  const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, RECENT_LIMIT);
  const json = JSON.stringify(next);
  if (blobEnabled()) await blobWrite("index/recent.json", json);
  else await localWrite("recent.json", json);
}

/**
 * The landing page shows a wall of sites, not a changelog of one site: eight visits to
 * the same host would look broken. The gallery still lists every run.
 */
export async function listRecentHosts(limit: number): Promise<RecentEntry[]> {
  return uniqueByHost(await listRecent(), limit);
}

export function uniqueByHost(recent: RecentEntry[], limit: number): RecentEntry[] {
  const seen = new Set<string>();
  const unique: RecentEntry[] = [];
  for (const entry of recent) {
    const host = entry.host.toLowerCase();
    if (seen.has(host)) continue;
    seen.add(host);
    unique.push(entry);
    if (unique.length >= limit) break;
  }
  return unique;
}

export async function findRecentByUrl(url: string): Promise<RecentEntry | null> {
  const recent = await listRecent();
  const normalized = url.replace(/\/$/, "").toLowerCase();
  return recent.find((entry) => entry.url.replace(/\/$/, "").toLowerCase() === normalized && entry.status === "complete") ?? null;
}

export function newRunId(): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${time}-${random}`;
}
