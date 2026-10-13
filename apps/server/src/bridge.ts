import type { BrowserBridge, RawSiteMetadata, ScrapedPage } from "@homepage/agent-core";
import { cleanHtmlForLLM } from "./sanitize";
import { fetchSource, itemsToHtml, type Source } from "./sources";
import type { Scraper } from "./browser";

export interface ServerBridgeOptions {
  sources: Source[];
  scraper: Pick<Scraper, "scrape">;
  githubToken: string | null;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

/**
 * The server's BrowserBridge: "history" is the curated source list; pages come
 * from feed/API fetches for structured sources and a headless browser for the rest.
 */
export function makeServerBridge(opts: ServerBridgeOptions): BrowserBridge {
  const byUrl = new Map(opts.sources.map((s) => [s.url, s]));
  const now = Date.now();
  return {
    async getHistory({ maxResults }) {
      const sites: RawSiteMetadata[] = opts.sources.map((s) => ({
        domain: s.label,
        totalVisits: s.weight * 10,
        uniquePages: 1,
        lastVisitTime: now,
        averageVisitsPerDay: s.weight,
        titles: [],
        urls: [s.url],
        relevanceScore: s.weight,
        sourceUrl: s.url,
        sourceKind: s.kind,
      }));
      return { sites: sites.slice(0, maxResults), totalSitesSeen: sites.length };
    },

    async getPageHtml({ urls, loadDelayMs }) {
      const pages: ScrapedPage[] = [];
      const failed: Array<{ url: string; reason: string }> = [];
      const queue = [...urls];
      // Three at a time: enough to be quick, few enough for a small VPS.
      const worker = async () => {
        for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
          try {
            if (opts.signal?.aborted) throw new Error("cancelled");
            const src = byUrl.get(url);
            if (src && src.kind !== "web") {
              const items = await fetchSource(src, { githubToken: opts.githubToken });
              if (!items.length) throw new Error("source returned no items");
              pages.push({ url, finalUrl: url, title: src.label, html: cleanHtmlForLLM(itemsToHtml(src.label, items)) });
            } else {
              pages.push(await opts.scraper.scrape(url, loadDelayMs ?? 3000, opts.signal));
            }
          } catch (err) {
            // Short, non-sensitive reason: the model sees this.
            const reason = String((err as Error)?.message ?? err).slice(0, 160);
            opts.log?.(`source failed ${url}: ${reason}`);
            failed.push({ url, reason });
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return { pages, failed };
    },
  };
}
