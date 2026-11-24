import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { categories } from "../shared/news.ts";
import type { NewsItem, NewsSnapshot } from "../shared/news.ts";
import { createClassifier } from "./classify.ts";
import type { KeywordRules } from "./classify.ts";
import { deduplicate } from "./dedupe.ts";
import { fetchFeed } from "./fetch-feeds.ts";
import { canonicalUrl, digest, parseFeed } from "./normalize.ts";
import type { FeedSource } from "./normalize.ts";
import { previousPublishedItems, previousSourceState, readPrevious, rollingItems, sortByDate, writeJson } from "./snapshot.ts";
import type { SourceState } from "./snapshot.ts";

interface Config {
  sources: FeedSource[];
  keywords: KeywordRules;
  aliases?: string[][];
}

interface CollectorState {
  sources: Record<string, SourceState>;
  publishedItems?: NewsItem[];
}

interface SourceResult {
  status: NewsSnapshot["sources"][number];
  state?: SourceState;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const maxPublishedItems = 400;
const concurrency = 4;

async function loadConfig(path: string): Promise<Config> {
  const config = JSON.parse(await readFile(path, "utf8")) as Config;
  const ids = new Set<string>();
  if (!Array.isArray(config?.sources) || !config.sources.length || !config.keywords) {
    throw new Error("Provide a sources list and a keyword dictionary.");
  }

  for (const source of config.sources) {
    if (!source || typeof source.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(source.id) || ids.has(source.id)
      || typeof source.name !== "string" || !source.name.trim()
      || typeof source.url !== "string" || !canonicalUrl(source.url)
      || (source.defaultCategories !== undefined && (!Array.isArray(source.defaultCategories)
        || source.defaultCategories.some((tag) => !categories.includes(tag))))
      || (source.enabled !== undefined && typeof source.enabled !== "boolean")
      || (source.summary !== undefined && typeof source.summary !== "boolean")
    ) {
      throw new Error(`Invalid or duplicate source configuration: ${source?.id ?? "missing id"}.`);
    }
    ids.add(source.id);
  }

  function wordList(list: unknown): boolean {
    return Array.isArray(list) && list.every((word) => typeof word === "string" && word.trim());
  }

  if (categories.some((category) => !wordList(config.keywords[category]))
    || (config.aliases !== undefined && (!Array.isArray(config.aliases) || !config.aliases.every(wordList)))) {
    throw new Error("Keyword and alias rules must contain lists of text.");
  }
  return config;
}

async function updateSource(
  source: FeedSource,
  previous: SourceState | undefined,
  classify: ReturnType<typeof createClassifier>,
  configHash: string,
  now: string,
): Promise<SourceResult> {
  const status = { id: source.id, name: source.name };
  const validCache = previous?.configHash === configHash ? previous : undefined;

  try {
    const response = await fetchFeed(source.url, validCache);
    let state: SourceState;

    if (response.status === 304) {
      if (!validCache || (!validCache.etag && !validCache.lastModified)) {
        throw new Error("Received HTTP 304 without a matching cached feed.");
      }
      state = {
        ...validCache,
        etag: response.validators.etag ?? validCache.etag,
        lastModified: response.validators.lastModified ?? validCache.lastModified,
        lastSuccessAt: now,
        ...rollingItems(validCache.items, [], now, validCache.firstSeen),
      };
    } else {
      const parsed = parseFeed(response.xml, { ...source, url: response.url }, now);
      const incoming = parsed.flatMap(({ classificationText, ...article }) => {
        const result = classify(article.title, classificationText, source.defaultCategories);
        return result.categories.length ? [{ ...article, ...result }] : [];
      });
      const carried = previous?.items ?? [];
      const cached = validCache ? carried : carried.flatMap((article) => {
        const result = classify(article.title, article.summary ?? "", source.defaultCategories);
        return result.categories.length ? [{ ...article, ...result }] : [];
      });
      state = {
        url: source.url,
        configHash,
        lastSuccessAt: now,
        ...response.validators,
        ...rollingItems(cached, incoming, now, previous?.firstSeen),
      };
    }

    console.log(`${source.name}: ${response.status}, ${state.items.length} retained`);
    return { status: { ...status, status: "ok", lastSuccessAt: now }, state };
  } catch (error) {
    console.warn(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
    return {
      status: {
        ...status,
        status: previous ? "stale" : "error",
        lastSuccessAt: previous?.lastSuccessAt ?? null,
      },
      state: previous ? { ...previous, ...rollingItems(previous.items, [], now, previous.firstSeen) } : undefined,
    };
  }
}

async function update() {
  const { values } = parseArgs({ options: {
    config: { type: "string" },
    state: { type: "string" },
    output: { type: "string" },
  } });
  const configPath = values.config ? resolve(values.config) : resolve(root, "config/news.json");
  const statePath = values.state ? resolve(values.state) : resolve(root, ".cache/state.json");
  const outputPath = values.output ? resolve(values.output) : resolve(root, "public/data/news.json");
  if (new Set([configPath, statePath, outputPath]).size !== 3) {
    throw new Error("Configuration, state, and output must use distinct files.");
  }

  const [config, previous, published] = await Promise.all([
    loadConfig(configPath),
    readPrevious<CollectorState>(statePath),
    readPrevious<NewsSnapshot>(outputPath),
  ]);
  const active = config.sources.filter((source) => source.enabled !== false);
  const classify = createClassifier(config.keywords, config.aliases);
  const configHash = digest(JSON.stringify([config.keywords, config.aliases]));
  const now = new Date().toISOString();
  const results: SourceResult[] = [];

  for (let index = 0; index < active.length; index += concurrency) {
    const batch = await Promise.all(active.slice(index, index + concurrency).map((source) => {
      const previousState = previousSourceState(previous?.sources?.[source.id], source.url, source.summary === true);
      const hash = digest(JSON.stringify([configHash, source]));
      return updateSource(source, previousState, classify, hash, now);
    }));
    results.push(...batch);
  }

  if (!results.some(({ status }) => status.status === "ok")) {
    throw new Error("No active source could be refreshed. The previous snapshot is retained.");
  }
  const articles = results.flatMap(({ state }) => state?.items ?? []);
  const lastPublished = previousPublishedItems(published?.items ?? previous?.publishedItems);
  const items = deduplicate(articles, lastPublished).sort(sortByDate).slice(0, maxPublishedItems);
  if (!items.length) throw new Error("No matching articles to publish. The previous snapshot is retained.");

  const sources = results.map(({ status }) => status);
  const state: CollectorState = {
    sources: Object.fromEntries(results.flatMap((result) => (
      result.state ? [[result.status.id, result.state]] : []
    ))),
    publishedItems: items,
  };
  await writeJson(statePath, state);
  await writeJson(outputPath, { updatedAt: now, items, sources } satisfies NewsSnapshot);
  console.log(`Published ${items.length} articles from ${sources.filter((source) => source.status === "ok").length} refreshed sources.`);
}

update().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
