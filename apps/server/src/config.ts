/**
 * Everything the server reads from its environment, in one place. Secrets
 * (the Anthropic key, the admin token) are only ever read from here: they are
 * never written to the data directory, returned by the API or shown in the UI.
 */
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** IANA zone the schedule, the daily spend window and the model's "time of day" use. */
  tz: string;
  anthropicApiKey: string | null;
  githubToken: string | null;
  /** Cloudflare Access: when both are set, every request must carry a valid Access JWT. */
  cfTeamDomain: string | null;
  cfAud: string | null;
  /** Fallback auth for setups without Access: `Authorization: Bearer <token>` or `?token=` once. */
  adminToken: string | null;
  /** Explicit opt-in to serve without any auth (only sane on 127.0.0.1). */
  allowInsecureNoAuth: boolean;
  /** Optional URL that receives a JSON POST when a build fails or a spend cap stops one. */
  notifyWebhook: string | null;
  /** Directory holding the prebuilt `extension.zip`, if this image includes one. */
  publicDir: string | null;
  version: string;
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
    anthropicApiKey: blank(env.ANTHROPIC_API_KEY),
    githubToken: blank(env.GITHUB_TOKEN),
    cfTeamDomain,
    cfAud,
    adminToken,
    allowInsecureNoAuth: truthy(env.ALLOW_INSECURE_NO_AUTH),
    notifyWebhook: blank(env.NOTIFY_WEBHOOK_URL),
    publicDir: blank(env.PUBLIC_DIR),
    version: blank(env.APP_VERSION) ?? "dev",
  };
}

/** Refuse to start an internet-facing server with no authentication, unless explicitly told to. */
export function assertAuthConfigured(cfg: Config): void {
  if (cfg.cfTeamDomain || cfg.adminToken || cfg.allowInsecureNoAuth) return;
  throw new Error(
    "No authentication configured. Set CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD (Cloudflare Access), " +
      "or ADMIN_TOKEN, or ALLOW_INSECURE_NO_AUTH=1 if you are binding to localhost only.",
  );
}
