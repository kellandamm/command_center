import Anthropic from "@anthropic-ai/sdk";
import { STORAGE_KEYS, runHomepageBuild, type KVStore, type ModelUsage, type RunPhase } from "@homepage/agent-core";
import type { Config } from "./config";
import { makeServerBridge } from "./bridge";
import { Scraper } from "./browser";
import { notify } from "./notify";
import { SERVER_PROFILE } from "./profile";
import { requestCost, runtimeCost, type ModelPricing } from "./pricing";
import { renderDocument } from "./render";
import type { SettingsStore } from "./settings";
import { parseSources } from "./sources";
import { EditionStore, Ledger, newEditionId, spendTotals, type EditionMeta } from "./store";

export type Trigger = "manual" | "schedule";

export interface BuildStatus {
  running: boolean;
  buildId?: string;
  trigger?: Trigger;
  startedAt?: string;
  phase?: RunPhase | "idle";
  detail?: string;
  costUsd: number;
  capUsd: number;
  log: string[];
  /** The last build that ended, so the UI can show why nothing new appeared. */
  last?: { buildId: string; at: string; status: "ok" | "failed" | "cancelled" | "capped"; message: string; costUsd: number; editionId?: string };
}

export type StartResult = { ok: true; buildId: string } | { ok: false; code: "busy" | "no_key" | "no_sources" | "cap"; reason: string };

const MAX_DURATION_MS = 20 * 60_000;
const IN_FLIGHT = "buildInFlight";

interface Deps {
  cfg: Config;
  settings: SettingsStore;
  kv: KVStore;
  ledger: Ledger;
  editions: EditionStore;
  pricing: Record<string, ModelPricing>;
  scraper?: Scraper;
  /** Test seam. */
  makeClient?: (apiKey: string) => Anthropic;
  run?: typeof runHomepageBuild;
  now?: () => Date;
}

export class BuildManager {
  private status_: BuildStatus = { running: false, costUsd: 0, capUsd: 0, log: [] };
  private abort: AbortController | null = null;
  private cancelled = false;
  private done: Promise<void> = Promise.resolve();
  private scraper: Scraper;

  constructor(private d: Deps) {
    this.scraper = d.scraper ?? new Scraper();
  }

  status(): BuildStatus {
    return { ...this.status_, log: [...this.status_.log] };
  }
  get running() {
    return this.status_.running;
  }
  /** Resolves when the current build (if any) has fully finished, including cleanup. */
  idle(): Promise<void> {
    return this.done;
  }

  cancel(): boolean {
    if (!this.status_.running) return false;
    this.cancelled = true;
    this.abort?.abort();
    return true;
  }

  async close() {
    this.cancel();
    await this.done.catch(() => {});
    await this.scraper.close();
  }

  /** Remaining budget right now, or the reason there is none. */
  async budget(): Promise<{ capUsd: number } | { reason: string }> {
    const s = this.d.settings.get();
    const now = (this.d.now ?? (() => new Date()))();
    const t = spendTotals(await this.d.ledger.all(), now, this.d.cfg.tz);
    if (t.buildsToday >= s.caps.maxBuildsPerDay) return { reason: `Daily build limit reached (${s.caps.maxBuildsPerDay}).` };
    const dayLeft = s.caps.daily - t.today;
    const monthLeft = s.caps.monthly - t.thisMonth;
    if (dayLeft <= 0.01) return { reason: `Daily spend cap reached ($${s.caps.daily.toFixed(2)}).` };
    if (monthLeft <= 0.01) return { reason: `Monthly spend cap reached ($${s.caps.monthly.toFixed(2)}).` };
    // The tightest limit wins, so a build can never be started that could breach a cap.
    return { capUsd: Math.min(s.caps.perBuild, dayLeft, monthLeft) };
  }

  async start(trigger: Trigger): Promise<StartResult> {
    if (this.status_.running) return { ok: false, code: "busy", reason: "A build is already running." };
    const apiKey = this.d.cfg.anthropicApiKey;
    if (!apiKey) return { ok: false, code: "no_key", reason: "ANTHROPIC_API_KEY is not set on the server." };
    const settings = this.d.settings.get();
    const { sources } = parseSources(settings.sources);
    if (!sources.length) return { ok: false, code: "no_sources", reason: "Add at least one source in Settings." };
    const budget = await this.budget();
    if ("reason" in budget) return { ok: false, code: "cap", reason: budget.reason };

    const buildId = newEditionId((this.d.now ?? (() => new Date()))());
    const startedAt = new Date();
    this.cancelled = false;
    this.abort = new AbortController();
    this.status_ = {
      running: true, buildId, trigger, startedAt: startedAt.toISOString(), phase: "setup",
      costUsd: 0, capUsd: budget.capUsd, log: [], last: this.status_.last,
    };
    this.done = this.execute(buildId, trigger, startedAt, apiKey).catch((err) => {
      // execute() handles its own errors; this only guards against a bug in the handler itself.
      console.error("build handler crashed", err);
      this.status_.running = false;
    });
    return { ok: true, buildId };
  }

  private log(line: string) {
    const log = this.status_.log;
    log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
    if (log.length > 200) log.splice(0, log.length - 200);
  }

  private async execute(buildId: string, trigger: Trigger, startedAt: Date, apiKey: string) {
    const settings = this.d.settings.get();
    const signal = this.abort!.signal;
    const model = settings.model;
    const { sources } = parseSources(settings.sources);
    let tokenCost = 0;
    let capped = false;
    let summary = "";
    const total = () => tokenCost + runtimeCost(Date.now() - startedAt.getTime());
    const persist = () => this.d.kv.set(IN_FLIGHT, { buildId, startedAt: startedAt.toISOString(), tokenCost }).catch(() => {});
    const check = () => {
      this.status_.costUsd = total();
      if (!capped && this.status_.costUsd >= this.status_.capUsd) {
        capped = true;
        this.log(`spend cap reached ($${this.status_.costUsd.toFixed(2)} of $${this.status_.capUsd.toFixed(2)}): stopping`);
        this.abort?.abort();
      }
    };
    // Session runtime accrues even when no model request is finishing.
    const timer = setInterval(() => {
      check();
      if (Date.now() - startedAt.getTime() > MAX_DURATION_MS && !capped) {
        capped = true;
        this.log("maximum build time reached: stopping");
        this.abort?.abort();
      }
    }, 5000);
    await persist();

    let outcome: NonNullable<BuildStatus["last"]>;
    try {
      const client = (this.d.makeClient ?? ((key) => new Anthropic({ apiKey: key })))(apiKey);
      const bridge = makeServerBridge({
        sources, scraper: this.scraper, githubToken: this.d.cfg.githubToken, signal, log: (l) => this.log(l),
      });
      const result = await (this.d.run ?? runHomepageBuild)({
        client, store: this.d.kv, bridge, model, profile: SERVER_PROFILE,
        userSystemPrompt: settings.instructions || undefined,
        blockedSites: async () => this.d.settings.get().blockedSites,
        signal, now: startedAt,
        callbacks: {
          onModelUsage: (u: ModelUsage) => {
            tokenCost += requestCost(model, u, this.d.pricing);
            void persist();
            check();
          },
          onPhase: (phase, detail) => {
            this.status_.phase = phase;
            this.status_.detail = detail;
          },
          onText: (t) => {
            if (summary.length < 600) summary += t;
          },
          onLog: (l) => this.log(l),
        },
      });
      if (capped || signal.aborted) throw new Error("aborted");
      this.status_.phase = "writing";
      const date = new Intl.DateTimeFormat("en-US", { timeZone: this.d.cfg.tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(startedAt);
      const title = `Edition · ${date}`;
      const doc = await renderDocument(result.code, title);
      const meta: EditionMeta = {
        id: buildId, createdAt: startedAt.toISOString(), costUsd: round(total()), trigger, model,
        sources: sources.length, title, summary: summary.trim().replace(/\s+/g, " ").slice(0, 500),
      };
      await this.d.editions.save(meta, { tsx: result.code, doc });
      await this.d.editions.prune(settings.keepEditions);
      await this.d.ledger.append({ ts: new Date().toISOString(), buildId, status: "ok", costUsd: round(total()), editionId: buildId });
      outcome = { buildId, at: new Date().toISOString(), status: "ok", message: "Built a new edition.", costUsd: round(total()), editionId: buildId };
      this.log(`done: $${total().toFixed(3)}`);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 400);
      const status = capped ? "capped" : this.cancelled ? "cancelled" : "failed";
      const shown =
        status === "capped" ? `Stopped at the spend cap ($${total().toFixed(2)}).`
        : status === "cancelled" ? "Cancelled."
        : message;
      this.log(`${status}: ${shown}`);
      await this.d.ledger.append({ ts: new Date().toISOString(), buildId, status, costUsd: round(total()), note: shown }).catch(() => {});
      outcome = { buildId, at: new Date().toISOString(), status, message: shown, costUsd: round(total()) };
      if (status !== "cancelled") {
        await notify(this.d.cfg.notifyWebhook, { kind: `build_${status}`, message: `AI Homepage build ${status}: ${shown}`, buildId });
      }
    } finally {
      clearInterval(timer);
      await this.d.kv.remove(IN_FLIGHT).catch(() => {});
    }
    this.status_ = { ...this.status_, running: false, phase: "idle", detail: undefined, last: outcome };
    this.abort = null;
  }

  /**
   * After a crash or restart: a build that was mid-flight left a session (with scraped
   * content in its log) and uploaded files behind. Remove them and account for what it cost.
   */
  async recover(): Promise<void> {
    const inFlight = await this.d.kv.get<{ buildId: string; startedAt: string; tokenCost: number }>(IN_FLIGHT);
    const sessionId = await this.d.kv.get<string>(STORAGE_KEYS.activeSessionId);
    const fileIds = (await this.d.kv.get<string[]>(STORAGE_KEYS.uploadedFileIds)) ?? [];
    if (!inFlight && !sessionId && !fileIds.length) return;
    const apiKey = this.d.cfg.anthropicApiKey;
    if (inFlight) {
      const cost = inFlight.tokenCost + runtimeCost(Date.now() - new Date(inFlight.startedAt).getTime());
      await this.d.ledger.append({
        ts: new Date().toISOString(), buildId: inFlight.buildId, status: "failed", costUsd: round(cost),
        note: "Server restarted during the build (cost is an estimate).",
      });
    }
    if (apiKey) {
      const client = (this.d.makeClient ?? ((k) => new Anthropic({ apiKey: k })))(apiKey);
      await Promise.allSettled(fileIds.map((id) => client.beta.files.delete(id)));
      if (sessionId) {
        const deadline = Date.now() + 60_000;
        let interrupted = false;
        try {
          while (Date.now() < deadline) {
            const s = await client.beta.sessions.retrieve(sessionId);
            if (s.status !== "running") break;
            if (!interrupted) {
              await client.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] });
              interrupted = true;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
          await client.beta.sessions.delete(sessionId);
        } catch (err) {
          console.error(`recovery: could not delete session ${sessionId}:`, String(err));
        }
      }
    }
    // Without a key the remote session/uploads can't be cleaned; keep the ids so a later start can.
    if (apiKey) {
      await this.d.kv.remove(STORAGE_KEYS.uploadedFileIds);
      await this.d.kv.remove(STORAGE_KEYS.activeSessionId);
    }
    await this.d.kv.remove(IN_FLIGHT);
  }
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
