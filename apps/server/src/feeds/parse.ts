import { XMLParser } from "fast-xml-parser";
import sanitizeHtml from "sanitize-html";

export interface FeedSpec {
  id: string;
  url: string;
  label: string;
}

export interface FeedParse {
  feeds: FeedSpec[];
  errors: Array<{ line: number; text: string; reason: string }>;
}

const HN_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";

/**
 * One feed per line:
 *   hn
 *   https://example.com/feed.xml
 *   # comments and blank lines ignored
 */
export function parseFeedList(text: string): FeedParse {
  const feeds: FeedSpec[] = [];
  const errors: FeedParse["errors"] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const fail = (reason: string) => errors.push({ line: idx + 1, text: raw.trim().slice(0, 120), reason });
    if (/^hn$/i.test(line)) {
      const id = "hn";
      if (seen.has(id)) return fail("duplicate feed");
      seen.add(id);
      feeds.push({ id, url: HN_URL, label: "Hacker News" });
      return;
    }
    let u: URL;
    try {
      u = new URL(line);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      return fail("expected hn or an http(s) feed URL");
    }
    const id = u.href;
    if (seen.has(id)) return fail("duplicate feed");
    seen.add(id);
    feeds.push({ id, url: u.href, label: u.hostname.replace(/^www\./, "") });
  });
  return { feeds, errors };
}

export interface Item {
  title: string;
  link?: string;
  summary?: string;
  date?: string;
  meta?: string;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: true });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
const unescapeText = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const plain = (html: string, max = 400) =>
  unescapeText(sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })).replace(/\s+/g, " ").trim().slice(0, max);

export function parseFeed(body: string, baseUrl: string): Item[] {
  const doc = xml.parse(body);
  const abs = (l: string) => {
    try {
      return new URL(l, baseUrl).href;
    } catch {
      return undefined;
    }
  };
  if (doc.rss?.channel) {
    return arr<any>(doc.rss.channel.item).map((it) => ({
      title: plain(text(it.title), 200),
      link: abs(text(it.link)),
      summary: plain(text(it.description) || text(it["content:encoded"])),
      date: text(it.pubDate) || text(it["dc:date"]) || undefined,
    }));
  }
  if (doc.feed) {
    return arr<any>(doc.feed.entry).map((it) => {
      const links = arr<any>(it.link);
      const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      return {
        title: plain(text(it.title), 200),
        link: alt?.["@_href"] ? abs(alt["@_href"]) : undefined,
        summary: plain(text(it.summary) || text(it.content)),
        date: text(it.updated) || text(it.published) || undefined,
      };
    });
  }
  const rdf = doc["rdf:RDF"];
  if (rdf) {
    return arr<any>(rdf.item).map((it) => ({
      title: plain(text(it.title), 200),
      link: abs(text(it.link)),
      summary: plain(text(it.description)),
      date: text(it["dc:date"]) || undefined,
    }));
  }
  throw new Error("not an RSS, Atom or RDF feed");
}
