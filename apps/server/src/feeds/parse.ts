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
      feeds.push({ id, url: HN_API_URL, label: "Hacker News" });
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

export interface ParsedItem extends Item {
  guid?: string;
  contentHtml?: string;
  thumbUrl?: string;
  durationSec?: number;
}

export const HN_FEED_ID = "hn";
export const HN_API_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";

const READ_PANE_ALLOWED = {
  allowedTags: [
    "p", "br", "b", "i", "em", "strong", "a", "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4",
    "img", "figure", "figcaption", "span", "div", "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "width", "height"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};

export function sanitizeReadingHtml(html: string): string {
  return sanitizeHtml(html, READ_PANE_ALLOWED as sanitizeHtml.IOptions);
}

function parseDuration(iso?: string): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return undefined;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

function youtubeThumb(link?: string, videoId?: string): string | undefined {
  const id =
    videoId ||
    (link && (link.match(/[?&]v=([a-zA-Z0-9_-]{6,})/)?.[1] || link.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/)?.[1]));
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
}

function thumbFromItem(it: Record<string, unknown>, link?: string): string | undefined {
  const group = it["media:group"] as Record<string, unknown> | undefined;
  const media = it["media:thumbnail"] ?? group?.["media:thumbnail"];
  const nodes = arr<any>(media);
  const url = nodes[0]?.["@_url"] ? String(nodes[0]["@_url"]) : undefined;
  if (url) return url;
  const yt = text(it["yt:videoId"]);
  return youtubeThumb(link, yt || undefined);
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: true });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));
const unescapeText = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const plain = (html: string, max = 400) =>
  unescapeText(sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })).replace(/\s+/g, " ").trim().slice(0, max);

function mapRssItem(it: any, abs: (l: string) => string | undefined): ParsedItem {
  const rawDesc = text(it.description) || text(it["content:encoded"]);
  const link = abs(text(it.link));
  return {
    title: plain(text(it.title), 200),
    link,
    guid: text(it.guid) || link || plain(text(it.title), 200),
    summary: plain(rawDesc),
    contentHtml: rawDesc ? sanitizeReadingHtml(unescapeText(rawDesc)) : undefined,
    date: text(it.pubDate) || text(it["dc:date"]) || undefined,
    thumbUrl: thumbFromItem(it, link),
    durationSec: parseDuration(text(it["media:content"]?.["@_duration"]) || text(it["itunes:duration"])),
  };
}

export function parseFeed(body: string, baseUrl: string): ParsedItem[] {
  const doc = xml.parse(body);
  const abs = (l: string) => {
    try {
      return new URL(l, baseUrl).href;
    } catch {
      return undefined;
    }
  };
  if (doc.rss?.channel) {
    return arr<any>(doc.rss.channel.item).map((it) => mapRssItem(it, abs));
  }
  if (doc.feed) {
    return arr<any>(doc.feed.entry).map((it) => {
      const links = arr<any>(it.link);
      const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      const link = alt?.["@_href"] ? abs(alt["@_href"]) : undefined;
      const raw = text(it.summary) || text(it.content);
      return {
        title: plain(text(it.title), 200),
        link,
        guid: text(it.id) || link || plain(text(it.title), 200),
        summary: plain(raw),
        contentHtml: raw ? sanitizeReadingHtml(unescapeText(raw)) : undefined,
        date: text(it.updated) || text(it.published) || undefined,
        thumbUrl: thumbFromItem(it, link) || youtubeThumb(link),
        durationSec: parseDuration(text(it["media:group"]?.["media:content"]?.["@_duration"])),
      };
    });
  }
  const rdf = doc["rdf:RDF"];
  if (rdf) {
    return arr<any>(rdf.item).map((it) => mapRssItem(it, abs));
  }
  throw new Error("not an RSS, Atom or RDF feed");
}
