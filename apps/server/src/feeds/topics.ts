import type { StoredItem } from "./store";

export interface TopicTag {
  id: string;
  label: string;
}

/** Static topic catalog — assignment uses keyword + feed rules only (no LLM). */
export const TOPIC_TAGS: TopicTag[] = [
  { id: "security", label: "Security" },
  { id: "ai", label: "AI" },
  { id: "dev", label: "Dev" },
  { id: "cloud", label: "Cloud" },
  { id: "business", label: "Business" },
  { id: "science", label: "Science" },
  { id: "community", label: "Community" },
];

const KEYWORD_RULES: Array<{ tag: string; words: string[] }> = [
  { tag: "security", words: ["security", "cve", "vulnerability", "ransomware", "phishing", "malware", "exploit", "breach", "zero-day", "encryption"] },
  { tag: "ai", words: [" ai ", "artificial intelligence", "machine learning", " llm", "gpt", "openai", "anthropic", "neural", "diffusion", "chatbot"] },
  { tag: "dev", words: ["github", "programming", "developer", "typescript", "javascript", "rust", "python", "golang", "api ", "open source", "pull request"] },
  { tag: "cloud", words: ["aws", "azure", "gcp", "kubernetes", "k8s", "docker", "serverless", "cloudflare", "terraform"] },
  { tag: "business", words: ["startup", "funding", "acquisition", "earnings", "ipo", "venture", "layoff", "market"] },
  { tag: "science", words: ["research", "nasa", "physics", "biology", "climate", "space", "quantum", "study finds"] },
];

function haystack(item: StoredItem): string {
  return ` ${(item.title ?? "").toLowerCase()} ${(item.summary ?? "").toLowerCase()} `;
}

function feedHost(feedId: string): string {
  if (feedId === "hn") return "news.ycombinator.com";
  try {
    return new URL(feedId).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return feedId.toLowerCase();
  }
}

/** Feed hostname → default topic when text rules miss. */
const FEED_TAGS: Array<{ match: (host: string, feedId: string) => boolean; tag: string }> = [
  { match: (h, id) => id === "hn" || h.includes("ycombinator"), tag: "community" },
  { match: (h) => h.includes("lobste"), tag: "dev" },
  { match: (h) => h.includes("techcrunch") || h.includes("theverge") || h.includes("arstechnica"), tag: "business" },
  { match: (h) => h.includes("krebsonsecurity") || h.includes("schneier"), tag: "security" },
  { match: (h) => h.includes("openai") || h.includes("anthropic"), tag: "ai" },
];

export function tagsForItem(item: StoredItem): string[] {
  const text = haystack(item);
  const found = new Set<string>();
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((w) => text.includes(w))) found.add(rule.tag);
  }
  const host = feedHost(item.feedId);
  for (const rule of FEED_TAGS) {
    if (rule.match(host, item.feedId)) found.add(rule.tag);
  }
  if (!found.size) found.add("community");
  return TOPIC_TAGS.map((t) => t.id).filter((id) => found.has(id));
}
