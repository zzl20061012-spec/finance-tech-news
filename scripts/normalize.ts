import { createHash } from "node:crypto";
import { decodeHTML } from "entities";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Category, NewsItem } from "../shared/news.ts";

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
  defaultCategories?: Category[];
  summary?: boolean;
  language?: string;
}

export interface CachedNewsItem extends NewsItem {
  feedId: string;
  firstSeenAt: string;
}

export interface ParsedNewsItem extends CachedNewsItem {
  classificationText: string;
}

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true,
});

const trackingKeys = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "_ga"]);

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function canonicalUrl(value: string, base?: string): string | undefined {
  if (!value.trim()) return;

  try {
    const url = new URL(value, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || trackingKeys.has(normalized)) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return;
  }
}

function node(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as XmlNode
    : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function xmlText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(xmlText).join(" ");
  return node(value) ? Object.entries(value as XmlNode)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, child]) => xmlText(child))
    .join(" ") : "";
}

function cleanText(value: unknown): string {
  return decodeHTML(xmlText(value))
    .replace(/<!--[^]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/[\p{Cc}\u200B-\u200D\uFEFF]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${Array.from(value).slice(0, limit - 1).join("").trimEnd()}…`;
}

function normalizeDate(value: unknown, firstSeenAt: string): string | null {
  const text = xmlText(value).trim();
  if (!text || !/\d{4}/.test(text)) return null;
  const timestamp = Date.parse(text);
  const latestAllowed = Date.parse(firstSeenAt) + 24 * 60 * 60 * 1000;
  return Number.isFinite(timestamp) && timestamp <= latestAllowed
    ? new Date(timestamp).toISOString()
    : null;
}

function articleLink(entry: XmlNode, base: string): string | undefined {
  const original = canonicalUrl(xmlText(entry.origLink), base);
  if (original) return original;

  const links = list(entry.link);
  for (const link of links) {
    const linkNode = node(link);
    if (!linkNode) {
      const url = canonicalUrl(xmlText(link), base);
      if (url) return url;
      continue;
    }
    const relation = xmlText(linkNode["@_rel"]);
    const type = xmlText(linkNode["@_type"]);
    if (relation && relation !== "alternate") continue;
    if (type && !["text/html", "application/xhtml+xml"].includes(type.split(";")[0])) continue;
    const linkBase = canonicalUrl(xmlText(linkNode["@_base"]), base) ?? base;
    const url = canonicalUrl(xmlText(linkNode["@_href"] ?? linkNode["#text"]), linkBase);
    if (url) return url;
  }

  const guid = node(entry.guid);
  return guid?.["@_isPermaLink"] === "false"
    ? undefined
    : canonicalUrl(xmlText(entry.guid ?? entry.id));
}

function readEntries(xml: string): { container: XmlNode; entries: unknown[] } {
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) {
    throw new Error("DTD and custom entities are unsupported.");
  }
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid feed XML.");

  const parsed = node(parser.parse(xml));
  const channel = node(node(parsed?.rss)?.channel);
  const feed = node(parsed?.feed);
  const rdf = node(parsed?.RDF);
  if (channel) return { container: channel, entries: list(channel.item) };
  if (feed) return { container: feed, entries: list(feed.entry) };
  if (rdf) return { container: rdf, entries: list(rdf.item) };
  throw new Error("Response is neither RSS nor Atom.");
}

export function parseFeed(xml: string, source: FeedSource, firstSeenAt: string): ParsedNewsItem[] {
  const { container, entries } = readEntries(xml.replace(/^\uFEFF/, ""));
  const containerBase = canonicalUrl(xmlText(container["@_base"]), source.url) ?? source.url;
  const isGoogleNews = new URL(source.url).hostname === "news.google.com";
  const articles: ParsedNewsItem[] = [];

  for (const raw of entries) {
    const entry = node(raw);
    if (!entry) continue;
    const base = canonicalUrl(xmlText(entry["@_base"]), containerBase) ?? containerBase;
    const url = articleLink(entry, base);
    const title = shorten(cleanText(entry.title), 350);
    if (!title || !url) continue;

    const publisher = isGoogleNews ? shorten(cleanText(entry.source), 100) : "";
    const suffix = ` - ${publisher}`;
    const displayTitle = publisher && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
    if (!displayTitle) continue;

    const body = cleanText(entry.description ?? entry.summary ?? entry.encoded ?? entry.content);
    const summary = source.summary && body ? shorten(body, 240) : undefined;
    const publishedAt = [entry.pubDate, entry.published, entry.updated, entry.date]
      .map((value) => normalizeDate(value, firstSeenAt))
      .find((value) => value !== null) ?? null;

    articles.push({
      id: digest(url),
      feedId: source.id,
      firstSeenAt,
      title: displayTitle,
      url,
      source: publisher || source.name,
      publishedAt,
      categories: [],
      classificationText: body.slice(0, 600),
      ...(summary ? { summary } : {}),
    });
  }

  if (entries.length && !articles.length) throw new Error("Feed contains no usable titles and article links.");
  return articles;
}
