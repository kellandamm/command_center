import { mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config";
import { defaultDashboardLayout } from "./defaults";
import { normalizeDashboardLayout, parseDashboardLayout } from "./normalize";
import type { DashboardLayout } from "./types";
import { dashboardLayoutUserKey } from "./user-key";
import { widgetIdsForSession, type WidgetSessionOpts } from "./widgets";
import { writeFileAtomic } from "../store";
import { loadConfig } from "../config";
import { MAX_LAYOUT_BYTES } from "./schema";

const LEGACY_FILE = "dashboard-layout.json";
const LAYOUT_DIR = "dashboard-layouts";

export class LayoutPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutPayloadError";
  }
}

function layoutPath(dataDir: string, userKey: string): string {
  const safe = userKey.replace(/[^a-z0-9._@-]+/g, "_").slice(0, 120);
  return join(dataDir, LAYOUT_DIR, `${safe}.json`);
}

function isVerifiedOwner(cfg: Config, principal: { who: string; email?: string; owner?: boolean }): boolean {
  if (principal.owner === true) return true;
  if (!cfg.ownerEmails.length) return principal.who === "admin-token";
  return false;
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
    private cfg: Config,
  ) {}

  static async open(dataDir: string, cfg?: Config): Promise<DashboardLayoutStore> {
    return new DashboardLayoutStore(dataDir, cfg ?? loadConfig({ DATA_DIR: dataDir }));
  }

  sessionOpts(showBudget: boolean, showServiceStatus: boolean): WidgetSessionOpts {
    return { showBudget, showServiceStatus };
  }

  knownIds(opts: WidgetSessionOpts): string[] {
    return widgetIdsForSession(opts);
  }

  private ids(opts: WidgetSessionOpts): readonly string[] {
    return this.knownIds(opts);
  }

  async getForUser(
    principal: { who: string; email?: string; owner?: boolean },
    showBudget: boolean,
    showServiceStatus = showBudget,
  ): Promise<DashboardLayout> {
    const opts = this.sessionOpts(showBudget, showServiceStatus);
    const userKey = dashboardLayoutUserKey(principal);
    const cached = this.cache.get(`${userKey}:${showBudget}:${showServiceStatus}`);
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
        if (isVerifiedOwner(this.cfg, principal)) {
          raw = await migrateLegacyFile(this.dataDir, userKey);
        }
      } else {
        raw = null;
      }
    }

    const layout = raw
      ? parseDashboardLayout(raw, this.ids(opts), showBudget, {
          appendMissing: false,
          appendNewRegistryWidgets: true,
        })
      : defaultDashboardLayout({ showBudget, showServiceStatus });
    this.cache.set(`${userKey}:${showBudget}:${showServiceStatus}`, layout);
    return layout;
  }

  async updateForUser(
    principal: { who: string; email?: string },
    raw: unknown,
    showBudget: boolean,
    showServiceStatus = showBudget,
  ): Promise<DashboardLayout> {
    const opts = this.sessionOpts(showBudget, showServiceStatus);
    const userKey = dashboardLayoutUserKey(principal);
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (Buffer.byteLength(text) > MAX_LAYOUT_BYTES) {
      throw new LayoutPayloadError("Layout payload exceeds size limit");
    }
    try {
      const layout = normalizeDashboardLayout(raw, this.ids(opts), showBudget, {
        appendMissing: false,
        appendNewRegistryWidgets: false,
      });
      await mkdir(join(this.dataDir, LAYOUT_DIR), { recursive: true });
      await writeFileAtomic(layoutPath(this.dataDir, userKey), JSON.stringify(layout, null, 2));
      this.cache.set(`${userKey}:${showBudget}:${showServiceStatus}`, layout);
      return layout;
    } catch (error) {
      if (error instanceof LayoutPayloadError) throw error;
      throw new LayoutPayloadError("Invalid dashboard layout");
    }
  }

  async resetForUser(
    principal: { who: string; email?: string },
    showBudget: boolean,
    showServiceStatus = showBudget,
  ): Promise<DashboardLayout> {
    const layout = defaultDashboardLayout({ showBudget, showServiceStatus });
    const userKey = dashboardLayoutUserKey(principal);
    await mkdir(join(this.dataDir, LAYOUT_DIR), { recursive: true });
    await writeFileAtomic(layoutPath(this.dataDir, userKey), JSON.stringify(layout, null, 2));
    this.cache.set(`${userKey}:${showBudget}:${showServiceStatus}`, layout);
    return layout;
  }

  /** @deprecated tests — single shared layout file interface */
  get(): DashboardLayout {
    return defaultDashboardLayout({ showBudget: false });
  }

  async update(raw: unknown): Promise<DashboardLayout> {
    return this.updateForUser({ who: "anonymous" }, raw, false, false);
  }

  async reset(): Promise<DashboardLayout> {
    return this.resetForUser({ who: "anonymous" }, false, false);
  }
}

export { dashboardLayoutUserKey };
