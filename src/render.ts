import type { Category, NewsItem, NewsSnapshot } from "../shared/news.ts";

const categoryLabels: Record<Category, string> = {
  semiconductor: "半导体",
  market: "股市",
  ai: "AI板块",
};

const sourceStatus: Record<NewsSnapshot["sources"][number]["status"], string> = {
  ok: "正常",
  stale: "沿用上次",
  error: "暂不可用",
};

const timeFormatter = new Intl.DateTimeFormat("zh-HK", {
  timeZone: "Asia/Hong_Kong",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatTimestamp(timestamp: string): string {
  return timeFormatter.format(new Date(timestamp));
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "always" });

function formatArticleTime(timestamp: string, now: number): string {
  const difference = Date.parse(timestamp) - now;
  if (!Number.isFinite(difference)) return "时间未知";

  const minutes = Math.floor(Math.abs(difference) / 60_000);
  if (minutes === 0) return "刚刚";

  const sign = Math.sign(difference);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return relativeTimeFormatter.format(sign * days, "day");
  if (hours > 0) return relativeTimeFormatter.format(sign * hours, "hour");
  return relativeTimeFormatter.format(sign * minutes, "minute");
}

export function updateArticleTimes(list: HTMLUListElement, now: number): void {
  for (const time of list.querySelectorAll<HTMLTimeElement>(".article-time")) {
    const label = formatArticleTime(time.dateTime, now);
    if (time.textContent !== label) time.textContent = label;
  }
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderArticle(item: NewsItem): HTMLLIElement {
  const entry = element("li", "news-entry");
  const article = element("article", "news-article");
  const metadata = element("div", "article-metadata");
  metadata.append(element("span", "article-source", item.source));

  if (item.publishedAt) {
    const time = element("time", "article-time", formatArticleTime(item.publishedAt, Date.now()));
    time.dateTime = item.publishedAt;
    time.title = formatTimestamp(item.publishedAt) + " 香港时间";
    metadata.append(time);
  }

  const tags = element("div", "topic-tags");
  for (const category of item.categories) {
    tags.append(element("span", "topic-tag topic-" + category, categoryLabels[category]));
  }
  metadata.append(tags);

  const heading = element("h3", "article-title");
  const link = element("a", "article-link", item.title);
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const arrow = element("span", "story-arrow", "↗");
  arrow.setAttribute("aria-hidden", "true");
  link.append(arrow);
  heading.append(link);
  article.append(metadata, heading);

  if (item.summary?.trim()) {
    article.append(element("p", "article-summary", item.summary));
  }

  entry.append(article);
  return entry;
}

export function renderArticles(list: HTMLUListElement, items: NewsItem[]): void {
  const content = document.createDocumentFragment();
  for (const item of items) {
    content.append(renderArticle(item));
  }
  list.replaceChildren(content);
}

export function renderSources(list: HTMLUListElement, sources: NewsSnapshot["sources"]): void {
  const content = document.createDocumentFragment();
  for (const source of sources) {
    const row = element("li", "source-row");
    const name = element("span", "source-name", source.name);
    const status = element("span", "source-status source-" + source.status, sourceStatus[source.status]);

    if (source.lastSuccessAt) status.title = "上次成功 · " + formatTimestamp(source.lastSuccessAt);
    row.append(name, status);
    content.append(row);
  }
  list.replaceChildren(content);
}

