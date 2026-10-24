import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import type { AgentApprovalsStore } from "../stores/agent-approvals";
import type { AgentTaskQueueStore } from "../stores/agent-task-queue";
import { authenticateQueueRequest, queueKeyForRole, queueRoleConfigured } from "./auth";
import { queueHmacVerify } from "./hmac";
import type { QueueNonceStore } from "./nonce-store";

const MAX_BODY = 32_000;

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readRawBody(req: IncomingMessage, limit = MAX_BODY): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(c as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export async function handleAgentQueueRoutes(
  cfg: Config,
  tasks: AgentTaskQueueStore,
  approvals: AgentApprovalsStore,
  nonces: QueueNonceStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (!path.startsWith("/api/queue") && !path.startsWith("/api/approvals")) return false;

  if (path === "/api/queue" && req.method === "POST") {
    if (!queueRoleConfigured(cfg, "producer")) return json(res, 404, { error: "not found" }), true;
    const raw = await readRawBody(req);
    const workerKey = queueKeyForRole(cfg, "worker");
    if (workerKey) {
      const tsStr = String(req.headers["x-queue-timestamp"] ?? "").trim();
      const nonceStr = String(req.headers["x-queue-nonce"] ?? "").trim();
      const sigStr = String(req.headers["x-queue-signature"] ?? "").trim();
      if (queueHmacVerify(workerKey, tsStr, nonceStr, raw, sigStr)) {
        return json(res, 403, { error: "worker key cannot create tasks" }), true;
      }
    }
    const auth = await authenticateQueueRequest(cfg, req, "producer", raw, nonces);
    if (!auth.ok) return json(res, auth.status, { error: auth.reason }), true;
    const body = parseJson(raw) as { text?: string; task?: string };
    const text = String(body.text ?? body.task ?? "").trim();
    if (!text) return json(res, 400, { error: "text is required" }), true;
    try {
      const task = await tasks.enqueue(text);
      return json(res, 201, { task }), true;
    } catch (err) {
      return json(res, 400, { error: err instanceof Error ? err.message : "enqueue failed" }), true;
    }
  }

  if (path === "/api/queue/next" && req.method === "GET") {
    if (!queueRoleConfigured(cfg, "worker")) return json(res, 404, { error: "not found" }), true;
    const raw = "";
    const auth = await authenticateQueueRequest(cfg, req, "worker", raw, nonces);
    if (!auth.ok) return json(res, auth.status, { error: auth.reason }), true;
    const task = await tasks.claimNext();
    return json(res, 200, { task }), true;
  }

  const resultMatch = path.match(/^\/api\/queue\/([^/]+)\/result$/);
  if (resultMatch && req.method === "POST") {
    if (!queueRoleConfigured(cfg, "worker")) return json(res, 404, { error: "not found" }), true;
    const raw = await readRawBody(req);
    const auth = await authenticateQueueRequest(cfg, req, "worker", raw, nonces);
    if (!auth.ok) return json(res, auth.status, { error: auth.reason }), true;
    const id = decodeURIComponent(resultMatch[1]!);
    const body = parseJson(raw) as {
      status?: string;
      summary?: string;
      evidence?: string;
      tokens_used?: number;
    };
    const status = body.status;
    if (status !== "done" && status !== "failed" && status !== "approval_needed") {
      return json(res, 400, { error: "status must be done, failed, or approval_needed" }), true;
    }
    const summary = String(body.summary ?? "").slice(0, 8_000);
    const updated = await tasks.recordResult(id, {
      status,
      summary,
      evidence: body.evidence !== undefined ? String(body.evidence).slice(0, 16_000) : undefined,
      tokens_used: typeof body.tokens_used === "number" ? body.tokens_used : undefined,
    });
    if (!updated) return json(res, 404, { error: "task not found or not leased" }), true;
    return json(res, 200, { task: updated }), true;
  }

  const proposalMatch = path.match(/^\/api\/queue\/([^/]+)\/proposals$/);
  if (proposalMatch && req.method === "POST") {
    if (!queueRoleConfigured(cfg, "worker")) return json(res, 404, { error: "not found" }), true;
    const raw = await readRawBody(req);
    const auth = await authenticateQueueRequest(cfg, req, "worker", raw, nonces);
    if (!auth.ok) return json(res, auth.status, { error: auth.reason }), true;
    const taskId = decodeURIComponent(proposalMatch[1]!);
    const task = tasks.get(taskId);
    if (!task) return json(res, 404, { error: "task not found" }), true;
    const body = parseJson(raw) as { action_id?: string; args?: Record<string, unknown>; reason?: string };
    if (!body.action_id) return json(res, 400, { error: "action_id is required" }), true;
    const approval = await approvals.createProposal({
      taskId,
      action_id: body.action_id,
      args: body.args && typeof body.args === "object" ? body.args : {},
      reason: String(body.reason ?? ""),
    });
    return json(res, 201, { approval }), true;
  }

  const getMatch = path.match(/^\/api\/queue\/([^/]+)$/);
  if (getMatch && req.method === "GET") {
    if (!queueRoleConfigured(cfg, "producer")) return json(res, 404, { error: "not found" }), true;
    const raw = "";
    const auth = await authenticateQueueRequest(cfg, req, "producer", raw, nonces);
    if (!auth.ok) return json(res, auth.status, { error: auth.reason }), true;
    const task = tasks.get(decodeURIComponent(getMatch[1]!));
    if (!task) return json(res, 404, { error: "task not found" }), true;
    return json(res, 200, { task }), true;
  }

  return false;
}

export async function handleAgentApprovalRoutes(
  cfg: Config,
  approvals: AgentApprovalsStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  owner: boolean,
  readBody: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  const approveMatch = path.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
  if (!approveMatch || req.method !== "POST") return false;

  if (!owner) {
    json(res, 403, { error: "owner login required" });
    return true;
  }

  await readBody(req);
  const id = decodeURIComponent(approveMatch[1]!);
  const decision = approveMatch[2] === "approve" ? "approved" : "denied";
  const row = await approvals.decide(id, decision);
  if (!row) {
    json(res, 409, { error: "proposal not found, not pending, or expired" });
    return true;
  }
  json(res, 200, { approval: row });
  return true;
}

/** Owner UI: list agent queue tasks and pending approvals (session auth). */
export function handleAgentQueueOwnerApi(
  tasks: AgentTaskQueueStore,
  approvals: AgentApprovalsStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  owner: boolean,
): boolean {
  if (path === "/api/agent-queue/overview" && req.method === "GET") {
    if (!owner) {
      json(res, 403, { error: "owner login required" });
      return true;
    }
    json(res, 200, {
      tasks: tasks.list(),
      approvals: approvals.list({ status: "pending" }),
    });
    return true;
  }
  return false;
}
