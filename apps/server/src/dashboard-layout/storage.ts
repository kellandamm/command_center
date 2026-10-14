import { join } from "node:path";
import { readJson, writeFileAtomic } from "../store";
import { defaultDashboardLayout } from "./defaults";
import { normalizeDashboardLayout } from "./normalize";
import type { DashboardLayout } from "./types";

export class DashboardLayoutStore {
  private data: DashboardLayout;

  private constructor(
    private path: string,
    private panelIds: readonly string[],
    initial: DashboardLayout,
  ) {
    this.data = initial;
  }

  static async open(dataDir: string, panelIds: readonly string[]): Promise<DashboardLayoutStore> {
    const path = join(dataDir, "dashboard-layout.json");
    const saved = await readJson<unknown>(path);
    const initial = saved ? normalizeDashboardLayout(saved, panelIds) : defaultDashboardLayout(panelIds);
    return new DashboardLayoutStore(path, panelIds, initial);
  }

  get(): DashboardLayout {
    return {
      ...this.data,
      panels: this.data.panels.map((p) => ({ ...p })),
    };
  }

  async update(raw: unknown): Promise<DashboardLayout> {
    const next = normalizeDashboardLayout(raw, this.panelIds);
    this.data = next;
    await writeFileAtomic(this.path, JSON.stringify(next, null, 2));
    return this.get();
  }

  async reset(): Promise<DashboardLayout> {
    const next = defaultDashboardLayout(this.panelIds);
    this.data = next;
    await writeFileAtomic(this.path, JSON.stringify(next, null, 2));
    return this.get();
  }
}
