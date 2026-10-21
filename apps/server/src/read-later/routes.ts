import type { IncomingMessage, ServerResponse } from "node:http";
import type { NotesStore } from "../notes/store";
import { ValidationError } from "../settings";
import { SummaryRateLimitError, type ReadLaterService } from "./service";
import type { CaptureAccess } from "./capture-access";

export async function handleReadLaterRoutes(
  notes: NotesStore, service: ReadLaterService, access: CaptureAccess,
  req: IncomingMessage, res: ServerResponse, path: string,
  readBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  const bodyObject = async () => {
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("body must be an object");
    return body as Record<string, unknown>;
  };
  if (path === "/api/capture/access") {
    if (req.method === "GET") json(200, { configured: await access.configured() });
    else if (req.method === "POST") json(201, { token: await access.rotate() });
    else if (req.method === "DELETE") { await access.revoke(); json(200, { ok: true }); }
    else return false;
    return true;
  }
  if (path === "/api/read-later" && req.method === "GET") {
    const url = new URL(req.url ?? "/", "http://local");
    const view = url.searchParams.get("view") ?? "inbox";
    const sources = notes.listSources(url.searchParams.get("q") ?? "");
    json(200, {
      sources: sources.filter((source) => view === "all" || (view === "archive" ? Boolean(source.archivedAt) : !source.archivedAt)),
      inboxCount: notes.listSources().filter((source) => !source.archivedAt).length,
    });
    return true;
  }
  if ((path === "/api/capture" || path === "/api/read-later") && req.method === "POST") {
    const body = await bodyObject();
    if (body.summarize !== undefined && typeof body.summarize !== "boolean") throw new ValidationError("summarize must be a boolean");
    const result = await notes.captureSource(body);
    if (body.summarize) {
      try {
        result.source = await service.summarize(result.source.id);
      } catch (err) {
        console.error("Saved page could not be summarized:", err instanceof Error ? err.message : err);
        json(result.duplicate ? 200 : 201, {
          ...result, summaryError: err instanceof Error ? err.message : "Summarization failed; the page is saved.",
        });
        return true;
      }
    }
    json(result.duplicate ? 200 : 201, result);
    return true;
  }
  const summary = path.match(/^\/api\/read-later\/([^/]+)\/summarize$/);
  if (summary && req.method === "POST") {
    const id = decodeURIComponent(summary[1]);
    if (!notes.getSource(id)) { json(404, { error: "source not found" }); return true; }
    try {
      json(200, { source: await service.summarize(id) });
    } catch (err) {
      if (err instanceof SummaryRateLimitError) { json(429, { error: err.message }); return true; }
      throw err;
    }
    return true;
  }
  return false;
}
