import type { IncomingMessage, ServerResponse } from "node:http";
import { OWNER_ACTION_FORBIDDEN } from "../owner-auth";
import { ValidationError } from "../settings";
import type { WhiteboardStore } from "./store";
import { MAX_WHITEBOARD_SCENE_BYTES } from "./sanitize";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

function ownerDenied(res: ServerResponse): void {
  json(res, 403, { error: OWNER_ACTION_FORBIDDEN });
}

async function readJson(req: IncomingMessage, maxBytes = MAX_WHITEBOARD_SCENE_BYTES + 64_000): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (Buffer.byteLength(body, "utf8") > maxBytes) throw new ValidationError("request body too large");
  }
  try {
    const parsed = JSON.parse(body || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object");
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) throw new ValidationError("invalid JSON");
    throw new ValidationError(err instanceof Error ? err.message : "invalid request");
  }
}

function sceneId(path: string): string | undefined {
  const match = path.match(/^\/api\/whiteboard\/scenes\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
}

export async function handleWhiteboardRoutes(
  store: WhiteboardStore,
  owner: boolean,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (path === "/api/whiteboard/scenes" && req.method === "GET") {
    json(res, 200, { scenes: store.list(), owner });
    return true;
  }
  if (path === "/api/whiteboard/scenes" && req.method === "POST") {
    if (!owner) return ownerDenied(res), true;
    const body = await readJson(req);
    const scene = await store.create({ title: body.title !== undefined ? String(body.title) : undefined, scene: body.scene });
    json(res, 201, { scene });
    return true;
  }
  const id = sceneId(path);
  if (id && req.method === "GET") {
    const scene = store.get(id);
    if (!scene) return json(res, 404, { error: "scene not found" }), true;
    json(res, 200, { scene });
    return true;
  }
  if (id && req.method === "PUT") {
    if (!owner) return ownerDenied(res), true;
    const body = await readJson(req);
    if (body.scene === undefined) return json(res, 400, { error: "scene is required" }), true;
    const scene = await store.save(id, {
      title: body.title !== undefined ? String(body.title) : undefined,
      scene: body.scene,
    });
    if (!scene) return json(res, 404, { error: "scene not found" }), true;
    json(res, 200, { scene });
    return true;
  }
  if (id && req.method === "DELETE") {
    if (!owner) return ownerDenied(res), true;
    const removed = await store.remove(id);
    json(res, 200, { removed });
    return true;
  }
  return false;
}
