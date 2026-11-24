import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { categories } from "../shared/news.ts";
import type { NewsItem } from "../shared/news.ts";
import type { FeedValidators } from "./fetch-feeds.ts";
import { canonicalUrl } from "./normalize.ts";
import type { CachedNewsItem } from "./normalize.ts";

export interface SourceState extends FeedValidators {
  url: string;
  configHash: string;
  lastSuccessAt: string;
  items: CachedNewsItem[];
  firstSeen?: Record<string, string>;
}

const maxItemsPerSource = 100;
const maxUndatedIds = 500;
const retentionMs = 7 * 24 * 60 * 60 * 1000;

export function sortByDate(a: NewsItem, b: NewsItem): number {
  return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
}

export function rollingItems(
  cached: CachedNewsItem[],
  incoming: CachedNewsItem[],
  now: string,
  firstSeen: Record<string, string> = {},
): { items: CachedNewsItem[]; firstSeen: Record<string, string> } {
  const seen = new Map(Object.entries(firstSeen));
  const byUrl = new Map(cached.map((item) => [item.url, item]));

  for (const article of [...incoming].reverse()) {
    const prior = byUrl.get(article.url);
    const publishedAt = article.publishedAt ?? prior?.publishedAt ?? null;
    const firstSeenAt = prior?.firstSeenAt ?? seen.get(article.id) ?? article.firstSeenAt;
    byUrl.set(article.url, { ...article, publishedAt, firstSeenAt });
    if (!publishedAt) {
      seen.delete(article.id);
      seen.set(article.id, firstSeenAt);
    }
  }

  const cutoff = Date.parse(now) - retentionMs;
  const items = [...byUrl.values()]
    .filter((item) => Date.parse(item.publishedAt ?? item.firstSeenAt) >= cutoff)
    .sort((a, b) => sortByDate(a, b) || b.firstSeenAt.localeCompare(a.firstSeenAt))
    .slice(0, maxItemsPerSource);

  return {
    items,
    firstSeen: Object.fromEntries([...seen].slice(-maxUndatedIds)),
  };
}

function dateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validItem(item: NewsItem | undefined | null): boolean {
  return Boolean(
    item && typeof item.id === "string"
    && typeof item.title === "string" && item.title.trim()
    && typeof item.source === "string" && item.source.trim()
    && typeof item.url === "string" && canonicalUrl(item.url)
    && (item.publishedAt === null || dateString(item.publishedAt))
    && Array.isArray(item.categories) && item.categories.every((category) => categories.includes(category))
    && (item.summary === undefined || typeof item.summary === "string")
    && (item.keywords === undefined || (Array.isArray(item.keywords) && item.keywords.every((word) => typeof word === "string"))),
  );
}

export async function readPrevious<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (!(error instanceof SyntaxError)) throw error;
    console.warn(`Ignoring invalid JSON in ${path}.`);
  }
}

export function previousSourceState(input: SourceState | undefined, url: string, allowSummary: boolean): SourceState | undefined {
  if (!input || input.url !== url || !dateString(input.lastSuccessAt) || !Array.isArray(input.items)) return;
  return {
    url: input.url,
    configHash: typeof input.configHash === "string" ? input.configHash : "",
    lastSuccessAt: input.lastSuccessAt,
    etag: typeof input.etag === "string" ? input.etag : undefined,
    lastModified: typeof input.lastModified === "string" ? input.lastModified : undefined,
    firstSeen: Object.fromEntries(Object.entries(input.firstSeen ?? {}).filter(([, value]) => dateString(value))),
    items: input.items
      .filter((item) => validItem(item) && dateString(item.firstSeenAt))
      .map((item) => {
        if (allowSummary) return item;
        const { summary: _summary, ...rest } = item;
        return rest;
      }),
  };
}

export function previousPublishedItems(items: NewsItem[] | undefined): NewsItem[] {
  return Array.isArray(items) ? items.filter(validItem) : [];
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true });
  }
}
