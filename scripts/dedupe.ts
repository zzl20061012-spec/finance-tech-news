import { categories } from "../shared/news.ts";
import type { NewsItem } from "../shared/news.ts";
import { canonicalUrl, digest } from "./normalize.ts";
import type { CachedNewsItem } from "./normalize.ts";

const titleWindowMs = 48 * 60 * 60 * 1000;

export function titleKey(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/[\p{P}\s\u200B-\u200D\uFEFF]/gu, "");
}

function isGoogleNews(url: string): boolean {
  return /^https?:\/\/news\.google\.com(?:\/|$)/i.test(url);
}

function chooseRepresentative(items: NewsItem[]): NewsItem {
  return items.reduce((current, candidate) => {
    if (isGoogleNews(current.url) !== isGoogleNews(candidate.url)) {
      return isGoogleNews(current.url) ? candidate : current;
    }
    return !current.publishedAt && candidate.publishedAt ? candidate : current;
  });
}

function articleTime(item: NewsItem): number {
  return Date.parse(item.publishedAt ?? (item as Partial<CachedNewsItem>).firstSeenAt ?? "");
}

function withinTitleWindow(a: NewsItem, b: NewsItem): boolean {
  const first = articleTime(a);
  const second = articleTime(b);
  return (Number.isNaN(first) && Number.isNaN(second)) || Math.abs(first - second) <= titleWindowMs;
}

export function deduplicate(items: NewsItem[], previousItems: NewsItem[] = []): NewsItem[] {
  const newestFirst = [...items].sort((a, b) => (articleTime(b) || 0) - (articleTime(a) || 0));
  const parents = newestFirst.map((_, index) => index);
  const byUrl = new Map<string, number>();
  const byTitle = new Map<string, number[]>();

  function root(index: number): number {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }

  for (const [index, article] of newestFirst.entries()) {
    const url = canonicalUrl(article.url) ?? article.url;
    const sameUrl = byUrl.get(url);
    if (sameUrl === undefined) byUrl.set(url, index);
    else parents[root(index)] = root(sameUrl);

    const key = titleKey(article.title);
    const anchors = byTitle.get(key) ?? [];
    const sameTitle = key ? anchors.find((anchor) => withinTitleWindow(article, newestFirst[anchor])) : undefined;
    if (sameTitle !== undefined) parents[root(index)] = root(sameTitle);
    else if (key) byTitle.set(key, [...anchors, index]);
  }

  const groups = new Map<number, NewsItem[]>();
  for (const [index, article] of newestFirst.entries()) {
    const group = root(index);
    const rows = groups.get(group);
    if (rows) rows.push(article);
    else groups.set(group, [article]);
  }

  const previousByUrl = new Map(previousItems.map((item) => [canonicalUrl(item.url) ?? item.url, item.id]));
  const previousByTitle = Map.groupBy(previousItems, (item) => titleKey(item.title));
  const usedIds = new Set<string>();
  const merged = [];

  for (const rows of groups.values()) {
    const representative = chooseRepresentative(rows);
    const { title, url, source, summary } = representative;
    const key = titleKey(title);
    const priorUrl = rows.map((row) => previousByUrl.get(canonicalUrl(row.url) ?? row.url))
      .find((id) => id && !usedIds.has(id));
    const priorTitle = rows.flatMap((row) => (previousByTitle.get(titleKey(row.title)) ?? [])
      .filter((previous) => withinTitleWindow(row, previous)))
      .find((previous) => !usedIds.has(previous.id))?.id;
    let id = priorUrl ?? priorTitle ?? digest(`url:${url}`);
    if (usedIds.has(id)) id = digest(`item:${url}\n${key}`);
    usedIds.add(id);

    const tags = new Set(rows.flatMap((row) => row.categories));
    const keywords = [...new Set(rows.flatMap((row) => row.keywords ?? []))];
    const publishedAt = representative.publishedAt ?? rows.find((row) => row.publishedAt)?.publishedAt ?? null;
    merged.push({
      id,
      title,
      url,
      source,
      publishedAt,
      categories: categories.filter((category) => tags.has(category)),
      ...(summary ? { summary } : {}),
      ...(keywords.length ? { keywords } : {}),
    });
  }

  return merged;
}
