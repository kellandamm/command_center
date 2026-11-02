import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { defaultDashboardLayout } from "./defaults";
import { normalizeDashboardLayout, parseDashboardLayout } from "./normalize";
import type { DashboardLayout } from "./types";
import { dashboardLayoutUserKey } from "./user-key";
import { widgetIdsForSession } from "./widgets";
import { writeFileAtomic } from "../store";
import { MAX_LAYOUT_BYTES } from "./schema";

const LEGACY_FILE = "dashboard-layout.json";
const LAYOUT_DIR = "dashboard-layouts";

function layoutPath(dataDir: string, userKey: string): string {
  const safe = userKey.replace(/[^a-z0-9._@-]+/g, "_").slice(0, 120);
  return join(dataDir, LAYOUT_DIR, `${safe}.json`);
}

async function migrateLegacyFile(dataDir: string, userKey: string): Promise<unknown | null> {
  const legacyPath = join(dataDir, LEGACY_FILE);
  try {
    const raw = await readFile(legacyPath, "utf8");
    await mkdir(join(dataDir, LAYOUT_DIR), { recursive: true });
    await writeFileAtomic(layoutPath(dataDir, userKey), raw);
    await rename(legacyPath, `${legacyPath}.migrated`);
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export class DashboardLayoutStore {
  private cache = new Map<string, DashboardLayout>();

  private constructor(
    private dataDir: string,
    private showBudget: boolean,
  ) {}

  static async open(dataDir: string, _panelIds?: readonly string[]): Promise<DashboardLayoutStore> {
    void _panelIds;
    return new DashboardLayoutStore(dataDir, false);
  }

  knownIds(showBudget: boolean): string[] {
    return widgetIdsForSession({ showBudget });
  }

  private ids(showBudget: boolean): readonly string[] {
    return this.knownIds(showBudget);
  }

  async getForUser(principal: { who: string; email?: string }, showBudget: boolean): Promise<DashboardLayout> {
    const userKey = dashboardLayoutUserKey(principal);
    const cached = this.cache.get(`${userKey}:${showBudget}`);
    if (cached) return cached;

    await mkdir(join(this.dataDir, LAYOUT_DIR), { recursive: true });
    const path = layoutPath(this.dataDir, userKey);
    let raw: unknown | null = null;
    try {
      const text = await readFile(path, "utf8");
      if (text.length > MAX_LAYOUT_BYTES) throw new Error("oversize");
      raw = JSON.parse(text);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        raw = await migrateLegacyFile(this.dataDir, userKey);
      } else {
        raw = null;
      }
    }

    const layout = raw
      ? parseDashboardLayout(raw, this.ids(showBudget), showBudget, { appendMissing: true })
      : defaultDashboardLayout({ showBudget });
    this.cache.set(`${userKey}:${showBudget}`, layout);
    return layout;
  }

  async updateForUser(
    principal: { who: string; email?: string },
    raw: unknown,
    showBudget: boolean,
  ): Promise<DashboardLayout> {
    const userKey = dashboardLayoutUserKey(principal);
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (Buffer.byteLength(text) > MAX_LAYOUT_BYTES) {
      return this.getForUser(principal, showBudget);
    }
    const layout = parseDashboardLayout(raw, this.ids(showBudget), showBudget, { appendMissing: false });
    await mkdir(join(this.dataDir, LAYOUT_DIR), { recursive: true });
    await writeFileAtomic(layoutPath(this.dataDir, userKey), JSON.stringify(layout, null, 2));
    this.cache.set(`${userKey}:${showBudget}`, layout);
    return layout;
  }

  async resetForUser(principal: { who: string; email?: string }, showBudget: boolean): Promise<DashboardLayout> {
    const layout = defaultDashboardLayout({ showBudget });
    const userKey = dashboardLayoutUserKey(principal);
    await mkdir(join(this.dataDir, LAYOUT_DIR), { recursive: true });
    await writeFileAtomic(layoutPath(this.dataDir, userKey), JSON.stringify(layout, null, 2));
    this.cache.set(`${userKey}:${showBudget}`, layout);
    return layout;
  }

  /** @deprecated tests — single shared layout file interface */
  get(): DashboardLayout {
    return defaultDashboardLayout({ showBudget: this.showBudget });
  }

  async update(raw: unknown): Promise<DashboardLayout> {
    return this.updateForUser({ who: "anonymous" }, raw, this.showBudget);
  }

  async reset(): Promise<DashboardLayout> {
    return this.resetForUser({ who: "anonymous" }, this.showBudget);
  }
}

export { dashboardLayoutUserKey };
