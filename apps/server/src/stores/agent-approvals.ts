import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface AgentApproval {
  id: string;
  taskId: string;
  action_id: string;
  args: Record<string, unknown>;
  reason: string;
  created_at: string;
  expires_at: string;
  status: ApprovalStatus;
  decided_at?: string;
}

const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const MAX_APPROVALS = 500;

export class AgentApprovalsStore {
  private items: AgentApproval[] = [];
  private queue: Promise<void> = Promise.resolve();

  private constructor(private path: string) {}

  static async open(dataDir: string): Promise<AgentApprovalsStore> {
    const store = new AgentApprovalsStore(join(dataDir, "agent-approvals.json"));
    const saved = await readJson<AgentApproval[]>(store.path);
    if (Array.isArray(saved)) store.items = saved;
    return store;
  }

  list(opts: { status?: ApprovalStatus; taskId?: string } = {}): AgentApproval[] {
    this.markExpired();
    let rows = [...this.items];
    if (opts.status) rows = rows.filter((a) => a.status === opts.status);
    if (opts.taskId) rows = rows.filter((a) => a.taskId === opts.taskId);
    return structuredClone(rows);
  }

  get(id: string): AgentApproval | undefined {
    this.markExpired();
    const row = this.items.find((a) => a.id === id);
    return row ? structuredClone(row) : undefined;
  }

  async createProposal(opts: {
    taskId: string;
    action_id: string;
    args: Record<string, unknown>;
    reason: string;
  }): Promise<AgentApproval> {
    const now = Date.now();
    const approval: AgentApproval = {
      id: randomUUID(),
      taskId: opts.taskId,
      action_id: String(opts.action_id ?? "").slice(0, 120),
      args: opts.args ?? {},
      reason: String(opts.reason ?? "").slice(0, 4_000),
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + PROPOSAL_TTL_MS).toISOString(),
      status: "pending",
    };
    return this.mutate(() => {
      this.items.push(approval);
      if (this.items.length > MAX_APPROVALS) this.items = this.items.slice(-MAX_APPROVALS);
      return structuredClone(approval);
    });
  }

  async decide(id: string, decision: "approved" | "denied"): Promise<AgentApproval | undefined> {
    return this.mutate(() => {
      this.markExpired();
      const row = this.items.find((a) => a.id === id);
      if (!row || row.status !== "pending") return undefined;
      if (Date.parse(row.expires_at) <= Date.now()) {
        row.status = "expired";
        return undefined;
      }
      row.status = decision;
      row.decided_at = new Date().toISOString();
      return structuredClone(row);
    });
  }

  private markExpired(): void {
    const now = Date.now();
    for (const row of this.items) {
      if (row.status === "pending" && Date.parse(row.expires_at) <= now) row.status = "expired";
    }
  }

  private async mutate<T>(change: () => T): Promise<T> {
    const run = this.queue.then(async () => {
      const result = change();
      await writeFileAtomic(this.path, JSON.stringify(this.items, null, 2));
      return result;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }
}
