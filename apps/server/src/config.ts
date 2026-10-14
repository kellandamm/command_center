/**
 * Environment configuration. Secrets (LLM key, admin token) are only read here —
 * never written to disk, returned by the API, or shown in the UI.
 */
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** IANA zone for schedules and briefing day boundaries. */
  tz: string;
  llmBaseUrl: string | null;
  llmApiKey: string | null;
  llmModel: string | null;
  githubToken: string | null;
  todoistApiToken: string | null;
  cfTeamDomain: string | null;
  cfAud: string | null;
  adminToken: string | null;
  allowInsecureNoAuth: boolean;
  version: string;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const truthy = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT is not a valid port: ${env.PORT}`);
  const tz = blank(env.TZ) ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`TZ is not a valid IANA time zone: ${tz}`);
  }
  const cfTeamDomain = blank(env.CF_ACCESS_TEAM_DOMAIN)?.replace(/^https?:\/\//, "").replace(/\/+$/, "") ?? null;
  const cfAud = blank(env.CF_ACCESS_AUD);
  if (Boolean(cfTeamDomain) !== Boolean(cfAud)) {
    throw new Error("Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither.");
  }
  const adminToken = blank(env.ADMIN_TOKEN);
  if (adminToken && adminToken.length < 24) throw new Error("ADMIN_TOKEN must be at least 24 characters.");
  return {
    port,
    host: blank(env.HOST) ?? "0.0.0.0",
    dataDir: blank(env.DATA_DIR) ?? "/data",
    tz,
    llmBaseUrl: blank(env.LLM_BASE_URL),
    llmApiKey: blank(env.LLM_API_KEY),
    llmModel: blank(env.LLM_MODEL),
    githubToken: blank(env.GITHUB_TOKEN),
    todoistApiToken: blank(env.TODOIST_API_TOKEN),
    cfTeamDomain,
    cfAud,
    adminToken,
    allowInsecureNoAuth: truthy(env.ALLOW_INSECURE_NO_AUTH),
    version: blank(env.APP_VERSION) ?? "dev",
  };
}

export function llmConfigured(cfg: Config): boolean {
  return Boolean(cfg.llmBaseUrl && cfg.llmApiKey && cfg.llmModel);
}

export function todoistConfigured(cfg: Config): boolean {
  return Boolean(cfg.todoistApiToken);
}

export function llmConfig(cfg: Config): LlmConfig | null {
  if (!llmConfigured(cfg)) return null;
  return { baseUrl: cfg.llmBaseUrl!.replace(/\/+$/, ""), apiKey: cfg.llmApiKey!, model: cfg.llmModel! };
}

export function assertAuthConfigured(cfg: Config): void {
  if (cfg.cfTeamDomain || cfg.adminToken || cfg.allowInsecureNoAuth) return;
  throw new Error(
    "No authentication configured. Set CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD (Cloudflare Access), " +
      "or ADMIN_TOKEN, or ALLOW_INSECURE_NO_AUTH=1 if you are binding to localhost only.",
  );
}
