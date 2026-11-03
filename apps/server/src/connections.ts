import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config";
import { ValidationError } from "./settings";
import { writeFileAtomic } from "./store";
import { assertPublicUrl, safeFetch } from "./ssrf";
import { notify, resolveNtfyConfig } from "./notify/ntfy";

const providers = {
  llm: { label: "AI summarizer", fields: ["llmBaseUrl", "llmApiKey", "llmModel"],
    usage: "Read Later summaries, answers grounded in Notes and Spaces, daily keyword digests, and weekly Wins summaries.",
    fallback: "Without all three fields, AI features are unavailable. Notes, saved links, calendar, and manual Wins remain usable." },
  brave: { label: "Brave Search", fields: ["braveSearchApiKey"],
    usage: "Web searches for Daily Briefing topics. Keyword digests also require the AI summarizer.",
    fallback: "Without this key, keyword digests are unavailable. Calendar and weather do not use Brave Search." },
  github: { label: "GitHub", fields: ["githubToken"],
    usage: "Hourly polling for merged pull requests to add to Agent Wins.",
    fallback: "Without a token, merged pull requests are not imported. Manual Wins and the local task board still work." },
  todoist: { label: "Todoist", fields: ["todoistApiToken"],
    usage: "The agent/MCP and webhook todoist_add_task action. This does not sync the local Hobie task board with Todoist.",
    fallback: "Without this token, agents cannot create Todoist tasks. The local task board is independent." },
  recallio: { label: "Recallio", fields: ["recallioUrl", "cfAccessClientId", "cfAccessClientSecret"],
    usage: "Memory search through the Recallio panel/API. Notes and Read Later are stored locally, not in Recallio.",
    fallback: "Without a URL, Recallio search is unavailable. Access client ID and secret are only needed together for a server behind Cloudflare Access." },
  ntfy: { label: "Phone notifications (ntfy)", fields: ["ntfyUrl", "ntfyTopic", "ntfyToken"],
    usage: "Phone notifications for briefing digests, reminders, and other alerts.",
    fallback: "A topic is required. URL defaults to https://ntfy.sh; a token is optional. Deployment ntfy values take precedence over saved settings, even when this connection is disconnected." },
} as const;

type Provider = keyof typeof providers;
type Field = (typeof providers)[Provider]["fields"][number];
interface Connection { disabled: boolean; values: Partial<Record<Field, string>>; updatedAt: string }
interface AccessCheck { ok: boolean; message: string; checkedAt: string }
type Data = Partial<Record<Provider, Connection>> & { secrets?: Record<string, string> };
const urls: Field[] = ["llmBaseUrl", "recallioUrl", "ntfyUrl"];
const aad = Buffer.from("command-center:connections:v1");
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function connectionProvider(value: string): Provider {
  if (!Object.hasOwn(providers, value)) throw new ValidationError("Unknown connection");
  return value as Provider;
}

export class ConnectionsStore {
  private data: Data = {};
  private queue: Promise<void> = Promise.resolve();
  private checks: Partial<Record<Provider, AccessCheck>> = {};
  readonly config: Config;
  private constructor(private env: Config, private path: string) {
    // Existing long-lived consumers keep this reference, so replacements and
    // disconnects become effective without mutating deployment defaults.
    this.config = new Proxy(env, {
      get: (target, key, receiver) => {
        for (const [id, descriptor] of Object.entries(providers)) {
          if (descriptor.fields.some((field) => field === key)) {
            const connection = this.data[id as Provider];
            if (connection?.disabled) return null;
            const value = connection?.values[key as Field];
            if (value !== undefined) return value;
          }
        }
        return Reflect.get(target, key, receiver);
      },
    });
  }

  static async open(env: Config): Promise<ConnectionsStore> {
    const store = new ConnectionsStore(env, join(env.dataDir, "connections.enc.json"));
    let raw: string;
    try { raw = await readFile(store.path, "utf8"); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return store;
      throw error;
    }
    if (!env.connectionsMasterKey) throw new Error("Connection vault exists: restore CONNECTIONS_MASTER_KEY before starting.");
    try {
      if (Buffer.byteLength(raw) > 256_000) throw new Error("size");
      const envelope: unknown = JSON.parse(raw);
      if (!record(envelope) || envelope.version !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string") throw new Error("format");
      const iv = Buffer.from(envelope.iv, "base64"), tag = Buffer.from(envelope.tag, "base64");
      if (iv.length !== 12 || tag.length !== 16) throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.connectionsMasterKey, "hex"), iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
      if (!record(parsed)) throw new Error("data");
      const data: Data = {};
      for (const [id, entry] of Object.entries(parsed)) {
        if (id === "secrets") {
          if (!record(entry)) throw new Error("secrets");
          data.secrets = {};
          for (const [name, value] of Object.entries(entry)) {
            if (!/^(calendar|google|fabric|fastio)\/[a-zA-Z0-9_-]+$/.test(name) || typeof value !== "string" || value.length > 32_000) throw new Error("secret");
            data.secrets[name] = value;
          }
          continue;
        }
        const provider = connectionProvider(id);
        if (!record(entry) || typeof entry.disabled !== "boolean" || !record(entry.values) || typeof entry.updatedAt !== "string") throw new Error("entry");
        const values: Partial<Record<Field, string>> = {};
        for (const [key, value] of Object.entries(entry.values)) {
          if (!providers[provider].fields.some((field) => field === key) || typeof value !== "string" || !value || value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error("field");
          values[key as Field] = value;
        }
        data[provider] = { disabled: entry.disabled, updatedAt: entry.updatedAt, values };
      }
      store.data = data;
    } catch {
      throw new Error("Cannot decrypt connection vault. Restore the matching master key and unmodified backup.");
    }
    return store;
  }

  status() {
    return {
      writable: !!this.env.connectionsMasterKey,
      githubUsername: this.config.githubUsername,
      connections: Object.entries(providers).map(([id, descriptor]) => {
        const provider = id as Provider;
        const saved = this.data[provider];
        const missingFields = this.requiredFields(provider).filter((field) => !this.effectiveValue(field));
        return {
          id, label: descriptor.label, disabled: provider === "ntfy" ? !resolveNtfyConfig(this.env, this.config).enabled && (saved?.disabled ?? false) : saved?.disabled ?? false, updatedAt: saved?.updatedAt ?? null,
          usage: descriptor.usage, fallback: descriptor.fallback,
          configured: missingFields.length === 0, missingFields,
          hasSavedSettings: !!saved,
          lastCheck: this.checks[provider] ?? null,
          fields: descriptor.fields.map((field) => ({
            name: field, secret: !urls.includes(field) && field !== "llmModel",
            configured: !!this.effectiveValue(field),
            source: provider === "ntfy" && this.env[field] ? "environment"
              : saved?.disabled ? "disabled" : saved?.values[field] !== undefined ? "saved"
              : this.env[field] ? "environment" : field === "ntfyUrl" ? "default" : "unset",
            value: this.displayValue(field),
          })),
        };
      }),
    };
  }

  private requiredFields(id: Provider): readonly Field[] {
    if (id === "ntfy") return ["ntfyTopic"];
    if (id !== "recallio") return providers[id].fields;
    return this.config.cfAccessClientId || this.config.cfAccessClientSecret
      ? providers.recallio.fields : ["recallioUrl"];
  }

  private effectiveValue(field: Field): string | null {
    if (field === "ntfyUrl" || field === "ntfyTopic" || field === "ntfyToken") {
      const ntfy = resolveNtfyConfig(this.env, this.config);
      return field === "ntfyUrl" ? ntfy.publishBase : field === "ntfyTopic" ? ntfy.topic : ntfy.token;
    }
    return this.config[field];
  }

  private displayValue(field: Field): string | null {
    const value = this.effectiveValue(field);
    if (!value) return null;
    if (field === "llmModel") return value;
    if (!urls.includes(field)) return null;
    try {
      const url = new URL(value);
      // Deployment URLs have not passed the vault's URL validation.
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
      return url.href.replace(/\/+$/, "");
    } catch { return null; }
  }

  async update(id: Provider, input: unknown): Promise<void> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Connection must be an object");
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["values", "disabled"].includes(key))) throw new ValidationError("Unknown connection property");
    if (body.disabled !== undefined && typeof body.disabled !== "boolean") throw new ValidationError("disabled must be a boolean");
    const disabled = body.disabled;
    const supplied = body.values ?? {};
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new ValidationError("values must be an object");
    const values: Partial<Record<Field, string>> = {};
    for (const [key, value] of Object.entries(supplied)) {
      if (!providers[id].fields.some((field) => field === key)) throw new ValidationError("Unknown connection field");
      if (typeof value !== "string" || !value.trim() || value.length > 4096 || /[\r\n\0]/.test(value)) throw new ValidationError("Use a non-empty single-line value (up to 4096 characters)");
      const field = key as Field;
      if (urls.includes(field)) {
        let url: URL;
        try { url = new URL(value); }
        catch { throw new ValidationError("Provider URL is invalid"); }
        if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) throw new ValidationError("Provider URL must use HTTPS without credentials, query, or fragment");
        try { await assertPublicUrl(value); }
        catch { throw new ValidationError("Provider URL must resolve to a public address"); }
      }
      values[field] = urls.includes(field) ? value.trim().replace(/\/+$/, "") : value.trim();
    }
    await this.commit((next) => {
      next[id] = {
        disabled: disabled === undefined ? next[id]?.disabled ?? false : disabled,
        values: { ...next[id]?.values, ...values }, updatedAt: new Date().toISOString(),
      };
    });
    delete this.checks[id];
  }

  async remove(id: Provider): Promise<void> {
    await this.commit((next) => { delete next[id]; });
    delete this.checks[id];
  }

  /** Server-only credential references; never included in status/API exports. */
  secret(name: string): string | undefined {
    return this.data.secrets?.[name];
  }

  async setSecret(name: string, value: string | null): Promise<void> {
    if (!/^(calendar|google|fabric|fastio)\/[a-zA-Z0-9_-]+$/.test(name) || (value !== null && (!value || value.length > 32_000))) {
      throw new ValidationError("Invalid credential reference");
    }
    await this.commit((next) => {
      next.secrets ??= {};
      if (value === null) delete next.secrets[name];
      else next.secrets[name] = value;
    });
  }

  private async commit(change: (next: Data) => void) {
    const key = this.env.connectionsMasterKey;
    if (!key) throw new ValidationError("Set CONNECTIONS_MASTER_KEY in deployment configuration to enable encrypted storage");
    const run = this.queue.then(async () => {
      const next = structuredClone(this.data);
      change(next);
      if (Buffer.byteLength(JSON.stringify(next)) > 180_000) throw new ValidationError("Connection vault is full; remove unused connections before saving");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(next), "utf8"), cipher.final()]);
      await writeFileAtomic(this.path, JSON.stringify({
        version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"),
      }));
      this.data = next;
    });
    this.queue = run.then(() => {}, () => {});
    await run;
  }

  async test(id: Provider, request = safeFetch): Promise<AccessCheck> {
    const cfg = this.config;
    const snapshot = providers[id].fields.map((field) => this.effectiveValue(field));
    const finish = (result: { ok: boolean; message: string }) => {
      const checkedAt = new Date().toISOString();
      if (!providers[id].fields.every((field, index) => this.effectiveValue(field) === snapshot[index])) {
        return { ok: false, message: "Settings changed during this check. Test the current settings again.", checkedAt };
      }
      const check = { ...result, checkedAt };
      this.checks[id] = check;
      return check;
    };
    if (this.requiredFields(id).some((field) => !this.effectiveValue(field))) return finish({ ok: false, message: "Connection is disabled or required fields are missing." });
    let url: string, headers: Record<string, string>;
    if (id === "ntfy") {
      const resolved = resolveNtfyConfig(this.env, this.config);
      if (!resolved.enabled) return finish({ ok: false, message: "Connection is disabled or required fields are missing." });
      const ok = await notify(resolved, { title: "Connection test", body: "Connection test", priority: "low" });
      return finish({ ok, message: ok ? "Notification accepted by the ntfy server." : "Provider did not pass the access check. Check credentials and endpoint." });
    }
    switch (id) {
      case "llm": url = `${cfg.llmBaseUrl!.replace(/\/+$/, "")}/models`; headers = { authorization: `Bearer ${cfg.llmApiKey}` }; break;
      case "brave": url = "https://api.search.brave.com/res/v1/web/search?q=connection%20test&count=1"; headers = { "X-Subscription-Token": cfg.braveSearchApiKey! }; break;
      case "github": url = "https://api.github.com/user"; headers = { authorization: `Bearer ${cfg.githubToken}` }; break;
      case "todoist": url = "https://api.todoist.com/api/v1/projects"; headers = { authorization: `Bearer ${cfg.todoistApiToken}` }; break;
      case "recallio": url = `${cfg.recallioUrl}/api/search?q=connection%20test`; headers = cfg.cfAccessClientId && cfg.cfAccessClientSecret ? { "cf-access-client-id": cfg.cfAccessClientId, "cf-access-client-secret": cfg.cfAccessClientSecret } : {}; break;
    }
    try {
      const response = await request(url, { headers, maxRedirects: 0, maxBytes: 64_000, timeoutMs: 10_000 });
      const ok = response.status >= 200 && response.status < 300 && response.contentType.includes("json");
      return finish({ ok, message: ok ? "Provider responded with JSON. This checks access, not every provider operation or model support." : `Provider did not pass the access check (HTTP ${response.status}). Check credentials and endpoint.` });
    } catch {
      // Provider bodies/errors can echo credentials; never expose them.
      return finish({ ok: false, message: "Provider could not be reached safely. Check its public HTTPS endpoint and network access." });
    }
  }
}
