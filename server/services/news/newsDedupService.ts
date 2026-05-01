/**
 * Deduplicate news articles by title hash with simple fuzzy collapsing.
 */

import type { NormalizedArticle } from "./stockNewsService";
import { createHash } from "crypto";

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function articleHash(a: NormalizedArticle): string {
  const dayPart = a.publishedAt.slice(0, 10);
  return createHash("sha1").update(`${normalizeTitle(a.headline)}|${dayPart}`).digest("hex");
}

function tokenSet(t: string): Set<string> {
  return new Set(normalizeTitle(t).split(" ").filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  a.forEach((x) => {
    if (b.has(x)) inter++;
  });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Drop exact-hash duplicates first, then collapse near-duplicates by token Jaccard ≥ 0.7.
 * For collapsed clusters keep the article whose source name sorts earliest (deterministic).
 */
export function dedupeArticles(articles: NormalizedArticle[]): NormalizedArticle[] {
  const seen = new Map<string, NormalizedArticle>();
  for (const a of articles) {
    const h = articleHash(a);
    if (!seen.has(h)) {
      seen.set(h, a);
    }
  }
  const exactDeduped = Array.from(seen.values());

  const tokenized = exactDeduped.map((a) => ({ a, tokens: tokenSet(a.headline) }));
  const kept: { a: NormalizedArticle; tokens: Set<string> }[] = [];
  for (const cur of tokenized) {
    const cluster = kept.find((k) => jaccard(k.tokens, cur.tokens) >= 0.7);
    if (!cluster) {
      kept.push(cur);
    } else if ((cur.a.source ?? "zzzzz") < (cluster.a.source ?? "zzzzz")) {
      cluster.a = cur.a;
      cluster.tokens = cur.tokens;
    }
  }
  return kept.map((k) => k.a);
}
