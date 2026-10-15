import type { Config } from "../config";
import { llmConfig } from "../config";
import { chatCompletion, type FetchLike } from "../llm/provider";
import { DEFAULT_SUMMARIZE_MAX_PER_HOUR } from "../feeds/summary-store";
import { groupWinsByIsoWeek, type WinsStore } from "./store";
import type { Win } from "./types";

export class WinsRollupService {
  constructor(
    private cfg: Config,
    private wins: WinsStore,
    private fetchFn: FetchLike = fetch,
  ) {}

  async weekSummary(isoWeek: string, weekWins: Win[], now = new Date()): Promise<string | null> {
    const cached = this.wins.getWeekSummary(isoWeek);
    if (cached) return cached.summary;

    const llm = llmConfig(this.cfg);
    if (!llm || !weekWins.length) return null;

    const since = new Date(now.getTime() - 60 * 60_000).toISOString();
    if (this.wins.countSummariesSince(since) >= DEFAULT_SUMMARIZE_MAX_PER_HOUR) return null;

    const lines = weekWins.map((w) => `- ${w.title} (${w.source})`).join("\n");
    try {
      const summary = await chatCompletion(
        llm,
        [
          {
            role: "system",
            content:
              "Write one short paragraph celebrating weekly wins for one person. Plain text, warm and specific, no markdown.",
          },
          { role: "user", content: `ISO week ${isoWeek} wins:\n${lines}` },
        ],
        this.fetchFn,
      );
      const text = summary.trim();
      if (!text) return null;
      this.wins.saveWeekSummary(isoWeek, text, llm.model, now.toISOString());
      return text;
    } catch {
      return null;
    }
  }

  async enrichWeeks(wins: Win[], now = new Date()): Promise<Map<string, string | null>> {
    const grouped = groupWinsByIsoWeek(wins);
    const out = new Map<string, string | null>();
    for (const [week, rows] of grouped) {
      out.set(week, await this.weekSummary(week, rows, now));
    }
    return out;
  }
}
