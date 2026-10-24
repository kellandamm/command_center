import { tokenEquals } from "./auth";

/**
 * Deployment defaults. Provider overrides are encrypted by ConnectionsStore.
 * Authentication/bootstrap secrets remain deployment-only.
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
  braveSearchApiKey: string | null;
  githubToken: string | null;
  /** GitHub login for the activity panel (open issues/PRs and public events). */
  githubUsername: string;
  todoistApiToken: string | null;
  /** Base URL for Recallio search (e.g. https://recall.gobison.io). */
  recallioUrl: string | null;
  /** Outbound Cloudflare Access service token (Recallio behind Access). */
  cfAccessClientId: string | null;
  cfAccessClientSecret: string | null;
  cfTeamDomain: string | null;
  /** Cloudflare Access application AUD tags (from `CF_ACCESS_AUD`, comma-separated). */
  cfAud: string[] | null;
  adminToken: string | null;
  allowInsecureNoAuth: boolean;
  /** Unix socket path for read-only Docker Engine API; null disables container list. */
  dockerSocket: string | null;
  version: string;
  /** WGS-84 latitude for Open-Meteo (defaults to Chicago). */
  weatherLat: number;
  /** WGS-84 longitude for Open-Meteo (defaults to Chicago). */
  weatherLon: number;
  /** Comma-separated https iCal feed URLs (may be empty). */
  icsUrls: string[];
  /** Local .ics file paths (dev/screenshots; not fetched over the network). */
  icsLocalFiles: string[];
  /** MCP: clientId → app bearer token (env JSON). */
  mcpAppTokens: Record<string, string>;
  /** MCP: clientId → Cloudflare Access service-token client id. */
  mcpCfClientMap: Record<string, string>;
  webhookSecret: string | null;
  /** Shared secret for POST /api/bookmarks/import (X bookmarks); ≥ 24 chars. */
  bookmarksImportSecret: string | null;
  /** Optional allow-list of Access service-token client ids (`common_name`) for bookmarks import. */
  bookmarksImportAllowedClientIds: string[];
  hobiePollToken: string | null;
  /** HMAC key for Hobie queue producer (create/read tasks). Min 32 chars when set. */
  queueHmacKeyProducer: string | null;
  /** HMAC key for homelab worker (claim/result/proposals). Min 32 chars when set. */
  queueHmacKeyWorker: string | null;
  mcpMaxHobiePending: number;
  connectionsMasterKey: string | null;
  ownerEmails: string[];
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleRedirectUri: string | null;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const truthy = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Default coordinates: downtown Chicago. */
export const DEFAULT_WEATHER_LAT = 41.8781;
export const DEFAULT_WEATHER_LON = -87.6298;

function parseLatLon(raw: string | undefined, fallback: number, name: string): number {
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function parseJsonRecord(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k.trim()] = v.trim();
    }
    return out;
  } catch {
    throw new Error("Invalid JSON object in MCP env var");
  }
}

/** Split on commas; empty segments are dropped. */
export function parseCommaList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split `ICS_URLS` on commas; empty segments are dropped. */
export function parseIcsUrls(raw: string | undefined): string[] {
  return parseCommaList(raw);
}

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
  const cfAudParts = parseCommaList(env.CF_ACCESS_AUD);
  const cfAud = cfAudParts.length ? cfAudParts : null;
  if (Boolean(cfTeamDomain) !== Boolean(cfAud)) {
    throw new Error("Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither.");
  }
  const adminToken = blank(env.ADMIN_TOKEN);
  if (adminToken && adminToken.length < 24) throw new Error("ADMIN_TOKEN must be at least 24 characters.");
  const mcpAppTokens = parseJsonRecord(env.MCP_APP_TOKENS);
  for (const [id, tok] of Object.entries(mcpAppTokens)) {
    if (tok.length < 24) throw new Error(`MCP_APP_TOKENS.${id} must be at least 24 characters.`);
  }
  const webhookSecret = blank(env.WEBHOOK_SECRET);
  if (webhookSecret && webhookSecret.length < 24) throw new Error("WEBHOOK_SECRET must be at least 24 characters.");
  const bookmarksImportSecret = blank(env.BOOKMARKS_IMPORT_SECRET);
  if (bookmarksImportSecret && bookmarksImportSecret.length < 24) {
    throw new Error("BOOKMARKS_IMPORT_SECRET must be at least 24 characters.");
  }
  const hobiePollToken = blank(env.HOBIE_POLL_TOKEN);
  if (hobiePollToken && hobiePollToken.length < 24) throw new Error("HOBIE_POLL_TOKEN must be at least 24 characters.");
  const connectionsMasterKey = blank(env.CONNECTIONS_MASTER_KEY);
  if (connectionsMasterKey && !/^[a-f0-9]{64}$/i.test(connectionsMasterKey)) {
    throw new Error("CONNECTIONS_MASTER_KEY must be 32 random bytes encoded as 64 hexadecimal characters.");
  }
  const googleClientId = blank(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = blank(env.GOOGLE_CLIENT_SECRET);
  const googleRedirectUri = blank(env.GOOGLE_REDIRECT_URI);
  if ([googleClientId, googleClientSecret, googleRedirectUri].some(Boolean)
    && ![googleClientId, googleClientSecret, googleRedirectUri].every(Boolean)) {
    throw new Error("Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI together.");
  }
  if (googleRedirectUri) {
    let redirect: URL;
    try { redirect = new URL(googleRedirectUri); }
    catch { throw new Error("GOOGLE_REDIRECT_URI must be a valid HTTPS URL (HTTP is allowed only for localhost)."); }
    const localHttp = redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
    if ((redirect.protocol !== "https:" && !localHttp) || redirect.username || redirect.password || redirect.hash || redirect.search) {
      throw new Error("GOOGLE_REDIRECT_URI must be HTTPS without credentials, query, or fragment (HTTP is allowed only for localhost).");
    }
    if (redirect.pathname !== "/api/google-calendar/callback") {
      throw new Error("GOOGLE_REDIRECT_URI must end with /api/google-calendar/callback.");
    }
  }
  return {
    port,
    host: blank(env.HOST) ?? "0.0.0.0",
    dataDir: blank(env.DATA_DIR) ?? "/data",
    tz,
    llmBaseUrl: blank(env.LLM_BASE_URL),
    llmApiKey: blank(env.LLM_API_KEY),
    llmModel: blank(env.LLM_MODEL),
    braveSearchApiKey: blank(env.BRAVE_SEARCH_API_KEY),
    githubToken: blank(env.GITHUB_TOKEN),
    githubUsername: blank(env.GITHUB_USERNAME) ?? "kellandamm",
    todoistApiToken: blank(env.TODOIST_API_TOKEN),
    recallioUrl: blank(env.RECALLIO_URL)?.replace(/\/+$/, "") ?? null,
    cfAccessClientId: blank(env.CF_ACCESS_CLIENT_ID),
    cfAccessClientSecret: blank(env.CF_ACCESS_CLIENT_SECRET),
    cfTeamDomain,
    cfAud,
    adminToken,
    allowInsecureNoAuth: truthy(env.ALLOW_INSECURE_NO_AUTH),
    dockerSocket: blank(env.DOCKER_SOCKET),
    version: blank(env.APP_VERSION) ?? "dev",
    weatherLat: parseLatLon(env.WEATHER_LAT, DEFAULT_WEATHER_LAT, "WEATHER_LAT"),
    weatherLon: parseLatLon(env.WEATHER_LON, DEFAULT_WEATHER_LON, "WEATHER_LON"),
    icsUrls: parseIcsUrls(env.ICS_URLS),
    icsLocalFiles: parseIcsUrls(env.ICS_LOCAL_FILES),
    mcpAppTokens,
    mcpCfClientMap: parseJsonRecord(env.MCP_CF_CLIENT_MAP),
    webhookSecret,
    bookmarksImportSecret,
    bookmarksImportAllowedClientIds: parseCommaList(env.BOOKMARKS_IMPORT_ALLOWED_CLIENT_IDS),
    hobiePollToken,
    queueHmacKeyProducer: blank(env.QUEUE_HMAC_KEY_PRODUCER),
    queueHmacKeyWorker: blank(env.QUEUE_HMAC_KEY_WORKER),
    mcpMaxHobiePending: Math.min(50, Math.max(1, Number(env.MCP_MAX_HOBIE_PENDING ?? 20) || 20)),
    connectionsMasterKey,
    ownerEmails: (env.OWNER_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
  };
}

export function mcpConfigured(cfg: Config): boolean {
  return Object.keys(cfg.mcpAppTokens).length > 0;
}

export function resolveMcpClientFromBearer(cfg: Config, bearer: string): string | null {
  for (const [clientId, token] of Object.entries(cfg.mcpAppTokens)) {
    if (tokenEquals(bearer, token)) return clientId;
  }
  return null;
}

export function mcpClientIdForCfAccessClientId(cfg: Config, cfClientId: string): string | null {
  for (const [clientId, mapped] of Object.entries(cfg.mcpCfClientMap)) {
    if (mapped === cfClientId) return clientId;
  }
  return null;
}

export function dockerSocketPath(cfg: Config): string | null {
  return cfg.dockerSocket;
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
