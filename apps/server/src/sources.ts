import { XMLParser } from "fast-xml-parser";
import sanitizeHtml from "sanitize-html";
import { safeFetch } from "./ssrf";

export type SourceKind = "web" | "rss" | "hn" | "github";

export interface Source {
  kind: SourceKind;
  /** The exact URL the agent is told to request. */
  url: string;
  label: string;
  /** 1-5 */
  weight: number;
}

export interface SourceParse {
  sources: Source[];
  errors: Array<{ line: number; text: string; reason: string }>;
}

const HN_LISTS = ["top", "new", "best", "ask", "show", "job"];
const FEED_PATH = /(\.(rss|atom|xml)$|\/(feed|rss|atom)(\.xml)?\/?$)/i;

/**
 *   hn | hn:best
 *   github:owner/repo | github:owner/repo#issues|pulls|releases
 *   rss:https://example.com/feed.xml     (a URL that looks like a feed is detected too)
 *   web:https://example.com | https://example.com
 *   any line may end in  *3  to set a weight 1-5
 *   # comments and blank lines are ignored
 */
export function parseSources(text: string): SourceParse {
  const sources: Source[] = [];
  const errors: SourceParse["errors"] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, idx) => {
    let line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const fail = (reason: string) => errors.push({ line: idx + 1, text: raw.trim().slice(0, 120), reason });
    let weight = 3;
    const w = line.match(/\s+\*\s*([1-5])$/);
    if (w) {
      weight = Number(w[1]);
      line = line.slice(0, w.index).trim();
    }
    let src: Source | undefined;
    const hn = line.match(/^hn(?::(\w+))?$/i);
    const gh = line.match(/^github:([\w.-]+)\/([\w.-]+)(?:#(releases|issues|pulls))?$/i);
    if (hn) {
      const list = (hn[1] ?? "top").toLowerCase();
      if (!HN_LISTS.includes(list)) return fail(`hn list must be one of ${HN_LISTS.join(", ")}`);
      src = { kind: "hn", url: `https://hacker-news.firebaseio.com/v0/${list}stories.json`, label: `Hacker News (${list})`, weight };
    } else if (gh) {
      const what = (gh[3] ?? "releases").toLowerCase();
      const repo = `${gh[1]}/${gh[2]}`;
      const url = `https://api.github.com/repos/${repo}/${what === "pulls" ? "pulls" : what}`;
      src = { kind: "github", url, label: `${repo} ${what}`, weight };
    } else {
      const m = line.match(/^(rss|web):(https?:\/\/.+)$/i);
      const kind = (m?.[1]?.toLowerCase() as SourceKind | undefined) ?? undefined;
      const urlText = m ? m[2]! : line;
      let u: URL;
      try {
        u = new URL(urlText);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      } catch {
        return fail("expected hn, github:owner/repo, rss:URL or a http(s) URL");
      }
      const k: SourceKind = kind ?? (FEED_PATH.test(u.pathname) ? "rss" : "web");
      src = { kind: k, url: u.href, label: u.hostname.replace(/^www\./, ""), weight };
    }
    if (seen.has(src.url)) return fail("duplicate source");
    seen.add(src.url);
    sources.push(src);
  });
  return { sources, errors };
}

// ---------------------------------------------------------------------------
// fetching

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
/** Strip all markup, then decode the entities sanitize-html leaves behind (callers re-escape on output). */
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
  // RSS 2.0
  if (doc.rss?.channel) {
    return arr<any>(doc.rss.channel.item).map((it) => ({
      title: plain(text(it.title), 200),
      link: abs(text(it.link)),
      summary: plain(text(it.description) || text(it["content:encoded"])),
      date: text(it.pubDate) || text(it["dc:date"]) || undefined,
    }));
  }
  // Atom
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
  // RSS 1.0 / RDF
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

async function getJson(url: string, headers?: Record<string, string>): Promise<any> {
  const res = await safeFetch(url, { headers: { accept: "application/json", ...headers }, maxBytes: 2_000_000 });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body);
}

async function fetchHn(url: string): Promise<Item[]> {
  const ids: number[] = (await getJson(url)).slice(0, 30);
  const items = await Promise.all(
    ids.map((id) => getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)),
  );
  return items
    .filter((it) => it && it.title && !it.dead && !it.deleted)
    .map((it) => ({
      title: String(it.title),
      link: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
      meta: `${it.score ?? 0} points, ${it.descendants ?? 0} comments — discussion: https://news.ycombinator.com/item?id=${it.id}`,
      date: it.time ? new Date(it.time * 1000).toISOString() : undefined,
    }));
}

async function fetchGithub(url: string, token: string | null): Promise<Item[]> {
  const rows: any[] = await getJson(url + (url.includes("?") ? "&" : "?") + "per_page=15", {
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  return rows.map((r) => ({
    title: String(r.name || r.title || r.tag_name),
    link: r.html_url,
    summary: plain(String(r.body ?? ""), 500),
    date: r.published_at ?? r.created_at,
    meta: r.tag_name ? `release ${r.tag_name}` : r.number ? `#${r.number} by ${r.user?.login ?? "?"}` : undefined,
  }));
}

export async function fetchSource(src: Source, ctx: { githubToken: string | null }): Promise<Item[]> {
  switch (src.kind) {
    case "rss": {
      const res = await safeFetch(src.url, { headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      return parseFeed(res.body, res.finalUrl).slice(0, 30);
    }
    case "hn":
      return fetchHn(src.url);
    case "github":
      return fetchGithub(src.url, ctx.githubToken);
    default:
      throw new Error("web sources are scraped, not fetched");
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Render structured items as the same kind of simple HTML the agent already knows how to read. */
export function itemsToHtml(label: string, items: Item[]): string {
  return (
    `<h1>${esc(label)}</h1>\n` +
    items
      .map(
        (it) =>
          `<div><h2>${it.link ? `<a href="${esc(it.link)}">${esc(it.title)}</a>` : esc(it.title)}</h2>` +
          `${it.date ? `<p>${esc(it.date)}</p>` : ""}${it.meta ? `<p>${esc(it.meta)}</p>` : ""}` +
          `${it.summary ? `<p>${esc(it.summary)}</p>` : ""}</div>`,
      )
      .join("\n")
  );
}
