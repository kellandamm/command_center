import { join } from "node:path";
import type { LlmConfig } from "../config";
import { dayKey } from "../store";
import { readJson, writeFileAtomic } from "../store";
import { chatCompletion } from "../llm/provider";
import type { FeedsStore, StoredItem } from "../feeds/store";

export interface BriefingRecord {
  day: string;
  generatedAt: string;
  content: string;
  itemCount: number;
  trigger: "schedule" | "manual";
  error?: string;
}

interface BriefingState {
  last?: BriefingRecord;
  history: BriefingRecord[];
}

const MAX_HISTORY = 14;

function formatItems(items: StoredItem[]): string {
  return items
    .map((it, i) => {
      const parts = [`${i + 1}. ${it.title}`];
      if (it.link) parts.push(`   ${it.link}`);
      if (it.summary) parts.push(`   ${it.summary.slice(0, 280)}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

export class BriefingService {
  private state: BriefingState = { history: [] };
  constructor(
    private path: string,
    private tz: string,
  ) {}

  static async open(dataDir: string, tz: string): Promise<BriefingService> {
    const svc = new BriefingService(join(dataDir, "briefing.json"), tz);
    const saved = await readJson<BriefingState>(svc.path);
    if (saved?.history) svc.state = saved;
    return svc;
  }

  get(): BriefingRecord | undefined {
    return this.state.last;
  }

  history(): BriefingRecord[] {
    return [...this.state.history];
  }

  async generate(opts: {
    llm: LlmConfig | null;
    feeds: FeedsStore;
    sinceIso: string;
    trigger: "schedule" | "manual";
    now?: Date;
    fetchFn?: typeof fetch;
    feedIds?: string[] | null;
  }): Promise<BriefingRecord> {
    const now = opts.now ?? new Date();
    const day = dayKey(now, this.tz);
    const items = opts.feeds.itemsForBriefing(opts.sinceIso, 40, opts.feedIds);
    if (!opts.llm) {
      const rec: BriefingRecord = {
        day,
        generatedAt: now.toISOString(),
        content: "",
        itemCount: items.length,
        trigger: opts.trigger,
        error: "LLM not configured (set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL)",
      };
      await this.persist(rec);
      return rec;
    }
    if (!items.length) {
      const rec: BriefingRecord = {
        day,
        generatedAt: now.toISOString(),
        content: "No new feed items since the last briefing.",
        itemCount: 0,
        trigger: opts.trigger,
      };
      await this.persist(rec);
      return rec;
    }
    try {
      const content = await chatCompletion(
        opts.llm,
        [
          {
            role: "system",
            content:
              "You write a concise morning briefing for one person. Use short sections and bullet points. " +
              "Highlight what matters, group related stories, and keep a calm practical tone. Plain text only.",
          },
          {
            role: "user",
            content: `Summarize these ${items.length} new feed items for today (${day}):\n\n${formatItems(items)}`,
          },
        ],
        opts.fetchFn,
      );
      const rec: BriefingRecord = { day, generatedAt: now.toISOString(), content, itemCount: items.length, trigger: opts.trigger };
      await this.persist(rec);
      return rec;
    } catch (err) {
      const rec: BriefingRecord = {
        day,
        generatedAt: now.toISOString(),
        content: "",
        itemCount: items.length,
        trigger: opts.trigger,
        error: err instanceof Error ? err.message : String(err),
      };
      await this.persist(rec);
      return rec;
    }
  }

  private async persist(rec: BriefingRecord): Promise<void> {
    this.state.last = rec;
    this.state.history = [rec, ...this.state.history.filter((h) => h.generatedAt !== rec.generatedAt)].slice(0, MAX_HISTORY);
    await writeFileAtomic(this.path, JSON.stringify(this.state, null, 2));
  }
}
