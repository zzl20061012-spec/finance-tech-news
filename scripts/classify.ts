import { categories } from "../shared/news.ts";
import type { Category } from "../shared/news.ts";

export type KeywordRules = Record<Category, string[]>;

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function matchingPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = /^[a-z0-9]/.test(term) ? "(?<![a-z0-9])" : "";
  const end = /[a-z0-9]$/.test(term) ? "(?![a-z0-9])" : "";
  return new RegExp(start + escaped + end, "u");
}

export function createClassifier(keywords: KeywordRules, aliases: string[][] = []) {
  const aliasPatterns = new Map<string, Set<string>>();
  const aliasGroups = aliases.map((labels) => {
    const terms = labels.map(normalize).filter(Boolean);
    for (const term of terms) {
      const related = aliasPatterns.get(term) ?? new Set<string>();
      for (const variant of terms) related.add(variant);
      aliasPatterns.set(term, related);
    }
    return { labels, patterns: terms.map(matchingPattern) };
  });

  const rules = categories.map((category) => ({
    category,
    terms: keywords[category].map((label) => {
      const key = normalize(label);
      const variants = aliasPatterns.get(key) ?? [key];
      return { label, patterns: Array.from(variants, matchingPattern) };
    }),
  }));

  return (title: string, text: string, defaults: Category[] = []) => {
    const searchable = normalize(`${title}\n${text}`);
    const tags = new Set<Category>(defaults);
    const matchedKeywords = new Set<string>();

    for (const { category, terms } of rules) {
      for (const { label, patterns } of terms) {
        if (patterns.some((pattern) => pattern.test(searchable))) {
          tags.add(category);
          matchedKeywords.add(label);
        }
      }
    }
    for (const { labels, patterns } of aliasGroups) {
      if (patterns.some((pattern) => pattern.test(searchable))) {
        for (const label of labels) matchedKeywords.add(label);
      }
    }

    return {
      categories: categories.filter((category) => tags.has(category)),
      keywords: [...matchedKeywords],
    };
  };
}

export function classifyArticle(
  title: string,
  text: string,
  defaults: Category[],
  keywords: KeywordRules,
  aliases: string[][] = [],
) {
  return createClassifier(keywords, aliases)(title, text, defaults);
}
