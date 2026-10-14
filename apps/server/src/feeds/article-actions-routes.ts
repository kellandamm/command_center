import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { llmConfigured } from "../config";
import { recallioConfigured, saveToRecallio } from "../recallio/client";
import type { NewsPrefsStore } from "./news-prefs";
import { articlePlainForLlm, sanitizeSummaryText } from "./summary-text";
import { SummaryDedupeError, SummaryRateLimitError, SummaryService } from "./summary-service";
import type { FeedsStore } from "./store";
import { ValidationError } from "../settings";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

export async function handleArticleActionRoutes(
  cfg: Config,
  feeds: FeedsStore,
  prefs: NewsPrefsStore,
  summaries: SummaryService,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  if (path === "/api/summaries" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://local");
    const q = url.searchParams.get("q") ?? undefined;
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 80)));
    const items = feeds.summaries.list({ q, limit });
    json(res, 200, { items, searchMode: feeds.usesFts5() ? "fts5" : "like" });
    return true;
  }

  if (path === "/api/rss/recallio" && req.method === "POST") {
    const body = (await readBody(req)) as { entryId?: string };
    if (!body.entryId) throw new ValidationError("entryId required");
    if (!recallioConfigured(cfg)) {
      json(res, 200, { configured: false, ok: false, error: "Recallio not configured" });
      return true;
    }
    const entry = feeds.getEntry(body.entryId);
    if (!entry) {
      json(res, 404, { error: "not found" });
      return true;
    }
    const ctx = feeds.feedContext(entry.feedId);
    const plain = articlePlainForLlm(entry).slice(0, 20_000);
    const outcome = await saveToRecallio(cfg, {
      title: entry.title,
      content: `${plain}\n\nFeed: ${ctx.feedTitle ?? entry.feedId}`,
      url: entry.link,
    });
    json(res, 200, outcome);
    return true;
  }

  if (path === "/api/rss/summarize" && req.method === "POST") {
    const body = (await readBody(req)) as { entryId?: string };
    if (!body.entryId) throw new ValidationError("entryId required");
    if (!llmConfigured(cfg)) {
      json(res, 200, { configured: false, ok: false, error: "LLM not configured" });
      return true;
    }
    try {
      const result = await summaries.summarizeEntry(body.entryId, prefs.get());
      await feeds.save();
      json(res, 200, {
        configured: true,
        ok: true,
        summary: result.summary,
        created: result.created,
        text: sanitizeSummaryText(result.summary.summary),
      });
    } catch (err) {
      if (err instanceof SummaryRateLimitError) {
        json(res, 429, { configured: true, ok: false, error: err.message });
        return true;
      }
      if (err instanceof SummaryDedupeError) {
        const existing = feeds.summaries.get(err.existingId);
        json(res, 200, { configured: true, ok: true, duplicate: true, summary: existing, text: existing?.summary });
        return true;
      }
      throw err;
    }
    return true;
  }

  return false;
}
