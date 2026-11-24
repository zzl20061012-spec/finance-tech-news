import type { Category, NewsItem, NewsSnapshot } from "../shared/news.ts";

const categories: ReadonlySet<string> = new Set<Category>(["semiconductor", "market", "ai"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isNewsItem(value: unknown): value is NewsItem {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    isWebUrl(value.url) &&
    typeof value.source === "string" &&
    (value.publishedAt === null || isTimestamp(value.publishedAt)) &&
    (value.summary === undefined || typeof value.summary === "string") &&
    Array.isArray(value.categories) &&
    value.categories.every((category) => typeof category === "string" && categories.has(category)) &&
    (value.keywords === undefined ||
      (Array.isArray(value.keywords) && value.keywords.every((keyword) => typeof keyword === "string")));
}

function isSource(value: unknown): value is NewsSnapshot["sources"][number] {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.status === "ok" || value.status === "stale" || value.status === "error") &&
    (value.lastSuccessAt === null || isTimestamp(value.lastSuccessAt));
}

export async function fetchNews(): Promise<NewsSnapshot> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(import.meta.env.BASE_URL + "data/news.json", {
      cache: "no-cache",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("资讯请求失败 (" + response.status + ")");

    const snapshot: unknown = await response.json();
    if (
      !isRecord(snapshot) ||
      !isTimestamp(snapshot.updatedAt) ||
      !Array.isArray(snapshot.items) ||
      !snapshot.items.every(isNewsItem) ||
      !Array.isArray(snapshot.sources) ||
      !snapshot.sources.every(isSource)
    ) {
      throw new Error("资讯快照格式无效");
    }

    return {
      updatedAt: snapshot.updatedAt,
      items: snapshot.items,
      sources: snapshot.sources,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

