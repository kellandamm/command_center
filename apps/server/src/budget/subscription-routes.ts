import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config";
import { ValidationError } from "../settings";
import { logBudgetError } from "./redact";
import type { BudgetStore } from "./store";
import { runSubscriptionDetection } from "./subscriptions/detect";
import type { SubscriptionCadence } from "./subscriptions/types";

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

const CADENCES = new Set<SubscriptionCadence>(["weekly", "monthly", "yearly"]);

export async function handleSubscriptionRoutes(
  store: BudgetStore,
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  readJson: () => Promise<unknown>,
): Promise<boolean> {
  if (!path.startsWith("/api/budget/subscriptions")) return false;

  try {
    if (path === "/api/budget/subscriptions" && req.method === "GET") {
      json(res, 200, store.subscriptionsForApi(cfg));
      return true;
    }

    if (path === "/api/budget/subscriptions" && req.method === "POST") {
      const body = (await readJson()) as Record<string, unknown>;
      const cadence = String(body.cadence ?? "monthly") as SubscriptionCadence;
      if (!CADENCES.has(cadence)) {
        json(res, 400, { error: "invalid cadence" });
        return true;
      }
      const sub = store.createSubscriptionManual({
        displayName: String(body.displayName ?? ""),
        payee: body.payee != null ? String(body.payee) : undefined,
        amountCents: Number(body.amountCents),
        cadence,
        anchorDate: String(body.anchorDate ?? new Date().toISOString().slice(0, 10)),
        categoryId: String(body.categoryId ?? ""),
        currency: body.currency != null ? String(body.currency) : undefined,
      });
      json(res, 201, { subscription: sub });
      return true;
    }

    if (path === "/api/budget/subscriptions/scan" && req.method === "POST") {
      const result = runSubscriptionDetection(store, cfg);
      json(res, 200, result);
      return true;
    }

    const subMatch = path.match(/^\/api\/budget\/subscriptions\/([^/]+)$/);
    if (subMatch && req.method === "PUT") {
      const id = decodeURIComponent(subMatch[1]!);
      const body = (await readJson()) as Record<string, unknown>;
      const cadenceRaw = body.cadence != null ? String(body.cadence) : undefined;
      if (cadenceRaw && !CADENCES.has(cadenceRaw as SubscriptionCadence)) {
        json(res, 400, { error: "invalid cadence" });
        return true;
      }
      const sub = store.updateSubscription(id, {
        displayName: body.displayName != null ? String(body.displayName) : undefined,
        payee: body.payee != null ? String(body.payee) : undefined,
        amountCents: body.amountCents != null ? Number(body.amountCents) : undefined,
        cadence: cadenceRaw as SubscriptionCadence | undefined,
        anchorDate: body.anchorDate != null ? String(body.anchorDate) : undefined,
        categoryId: body.categoryId !== undefined ? (body.categoryId == null ? null : String(body.categoryId)) : undefined,
        active: body.active != null ? Boolean(body.active) : undefined,
      });
      if (!sub) {
        json(res, 404, { error: "not found" });
        return true;
      }
      json(res, 200, { subscription: sub });
      return true;
    }

    const confirmMatch = path.match(/^\/api\/budget\/subscriptions\/detections\/([^/]+)\/confirm$/);
    if (confirmMatch && req.method === "POST") {
      const id = decodeURIComponent(confirmMatch[1]!);
      const body = (await readJson()) as Record<string, unknown>;
      const categoryId = String(body.categoryId ?? "");
      const cadenceRaw = body.cadence != null ? String(body.cadence) : undefined;
      if (cadenceRaw && !CADENCES.has(cadenceRaw as SubscriptionCadence)) {
        json(res, 400, { error: "invalid cadence" });
        return true;
      }
      const sub = store.confirmDetection(id, {
        categoryId,
        cadence: cadenceRaw as SubscriptionCadence | undefined,
        displayName: body.displayName != null ? String(body.displayName) : undefined,
        deactivateConflictingActive: body.deactivateConflictingActive === true,
      });
      if (!sub) {
        json(res, 404, { error: "not found" });
        return true;
      }
      json(res, 200, { subscription: sub });
      return true;
    }

    const dismissMatch = path.match(/^\/api\/budget\/subscriptions\/detections\/([^/]+)\/dismiss$/);
    if (dismissMatch && req.method === "POST") {
      const id = decodeURIComponent(dismissMatch[1]!);
      const det = store.dismissDetection(id);
      if (!det) {
        json(res, 404, { error: "not found" });
        return true;
      }
      json(res, 200, { detection: det });
      return true;
    }

    json(res, 404, { error: "not found" });
    return true;
  } catch (err) {
    if (err instanceof ValidationError) {
      logBudgetError("validation", { code: "validation" });
      json(res, 400, { error: "invalid request" });
      return true;
    }
    logBudgetError("subscription_route_error", { route: path.replace(/\?.*$/, "") });
    json(res, 500, { error: "budget request failed" });
    return true;
  }
}
