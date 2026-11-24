import type { Category, NewsItem, NewsSnapshot } from "../shared/news.ts";
import { fetchNews } from "./news-client.ts";
import { formatTimestamp, renderArticles, renderSources, updateArticleTimes } from "./render.ts";
import "./styles.css";

const refreshInterval = 5 * 60_000;
const staleAfter = 2 * 60 * 60_000;
const themeKey = "market-signal-theme";
type NewsFilter = Category | "all";

function getElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("页面缺少 " + id);
  return node as T;
}

const lastUpdated = getElement<HTMLTimeElement>("last-updated");
const countdown = getElement<HTMLSpanElement>("countdown");
const refreshButton = getElement<HTMLButtonElement>("refresh-button");
const refreshLabel = getElement<HTMLSpanElement>("refresh-label");
const themeButton = getElement<HTMLButtonElement>("theme-button");
const searchInput = getElement<HTMLInputElement>("search-input");
const resultCount = getElement<HTMLSpanElement>("result-count");
const newsList = getElement<HTMLUListElement>("news-list");
const newsEmpty = getElement<HTMLDivElement>("news-empty");
const sourceCount = getElement<HTMLSpanElement>("source-count");
const sourceList = getElement<HTMLUListElement>("source-list");
const sourcesEmpty = getElement<HTMLParagraphElement>("sources-empty");
const updateNotice = getElement<HTMLParagraphElement>("update-notice");
const topicFilters = document.querySelectorAll<HTMLButtonElement>(".topic-filter");

let activeFilter: NewsFilter = "all";
let snapshot: NewsSnapshot | undefined;
let searchableNews: { item: NewsItem; text: string }[] = [];
let refreshing = false;
let nextCheck = 0;
let lastArticleTimeMinute = -1;

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function getTheme(): "light" | "dark" {
  const savedTheme = document.documentElement.dataset.theme;
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return systemTheme.matches ? "dark" : "light";
}

function updateThemeButton(): void {
  const label = getTheme() === "dark" ? "切换到浅色主题" : "切换到深色主题";
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
}

themeButton.addEventListener("click", () => {
  const theme = getTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    // The switch still works for this visit when storage is unavailable.
  }
  updateThemeButton();
});
systemTheme.addEventListener("change", updateThemeButton);
updateThemeButton();

function normalizeSearch(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
}

function updateNewsList(): void {
  if (!snapshot) return;

  const query = normalizeSearch(searchInput.value);
  const words = query ? query.split(/\s+/) : [];
  const filtered = searchableNews
    .filter(({ item, text }) =>
      (activeFilter === "all" || item.categories.includes(activeFilter)) &&
      words.every((word) => text.includes(word))
    )
    .map(({ item }) => item);

  renderArticles(newsList, filtered);
  resultCount.textContent = filtered.length + " 条资讯";
  newsEmpty.hidden = filtered.length > 0;
  newsEmpty.textContent = query ? "未找到匹配的资讯。" : "这个板块暂时没有资讯。";
}

function setSnapshot(next: NewsSnapshot): void {
  snapshot = next;
  searchableNews = next.items
    .slice()
    .sort((left, right) =>
      (right.publishedAt ? Date.parse(right.publishedAt) : 0) -
      (left.publishedAt ? Date.parse(left.publishedAt) : 0)
    )
    .map((item) => ({
      item,
      text: normalizeSearch([item.title, item.source, item.summary, ...(item.keywords ?? [])].join(" ")),
    }));

  lastUpdated.dateTime = next.updatedAt;
  lastUpdated.textContent = formatTimestamp(next.updatedAt);
  lastUpdated.title = lastUpdated.textContent + " 香港时间";

  const healthySources = next.sources.filter((source) => source.status === "ok").length;
  sourceCount.textContent = next.sources.length ? healthySources + " / " + next.sources.length + " 正常" : "";
  sourcesEmpty.hidden = next.sources.length > 0;
  sourcesEmpty.textContent = "目前没有来源状态。";
  renderSources(sourceList, next.sources);
  updateNewsList();
}

function setNotice(text: string, isWarning = false): void {
  updateNotice.textContent = text;
  updateNotice.classList.toggle("notice-warning", isWarning);
}

function updateCountdown(): void {
  if (refreshing) {
    countdown.textContent = "检查中";
    return;
  }

  const seconds = Math.max(0, Math.ceil((nextCheck - Date.now()) / 1_000));
  const minutesText = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsText = String(seconds % 60).padStart(2, "0");
  countdown.textContent = minutesText + ":" + secondsText;
}

async function refreshNews(manual = false): Promise<void> {
  if (refreshing) return;

  refreshing = true;
  refreshButton.disabled = true;
  refreshButton.classList.add("is-refreshing");
  refreshLabel.textContent = "刷新中";
  updateCountdown();

  try {
    const incoming = await fetchNews();
    const timestamp = Date.parse(incoming.updatedAt);
    const changed = !snapshot || timestamp > Date.parse(snapshot.updatedAt);
    if (changed) setSnapshot(incoming);

    if (snapshot && Date.now() - Date.parse(snapshot.updatedAt) > staleAfter) {
      setNotice("已发布的资讯超过 2 小时未更新。", true);
    } else if (manual) {
      setNotice(changed ? "资讯已更新。" : "已检查，暂无新资讯。");
    } else {
      setNotice("");
    }
  } catch {
    if (snapshot) {
      setNotice("暂时无法检查更新，正在显示上次读取的资讯。", true);
    } else {
      resultCount.textContent = "资讯暂不可用";
      newsEmpty.textContent = "暂时无法读取资讯。请点按「立即刷新」重试。";
      lastUpdated.textContent = "暂未读取";
    }
  } finally {
    nextCheck = Date.now() + refreshInterval;
    refreshing = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-refreshing");
    refreshLabel.textContent = "立即刷新";
    updateCountdown();
  }
}

for (const button of topicFilters) {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter as NewsFilter;
    for (const filter of topicFilters) {
      filter.setAttribute("aria-pressed", String(filter === button));
    }
    updateNewsList();
  });
}

searchInput.addEventListener("input", updateNewsList);
refreshButton.addEventListener("click", () => void refreshNews(true));

function checkIfDue(): void {
  if (document.visibilityState !== "visible") return;

  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  if (minute !== lastArticleTimeMinute) {
    lastArticleTimeMinute = minute;
    updateArticleTimes(newsList, now);
  }

  if (now >= nextCheck && !refreshing) {
    void refreshNews();
  } else {
    updateCountdown();
  }
}

document.addEventListener("visibilitychange", checkIfDue);
window.addEventListener("online", checkIfDue);
window.setInterval(checkIfDue, 1_000);
void refreshNews();

