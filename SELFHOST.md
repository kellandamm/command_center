# Self-hosting AI Homepage

This fork adds `apps/server`: the same agent as the browser extension, run on a server on a schedule. It builds a personalised homepage from **sources you list** (RSS/Atom feeds, Hacker News, GitHub repos, public web pages) instead of your browsing history, keeps every edition, and has hard spend caps. The extension is unchanged apart from a few additive hooks in `packages/agent-core`, and is also served from the server's **Extension** page as a ready-to-load zip.

## What's different from the extension

| | Extension | Server |
|---|---|---|
| Input | Your browsing history | A source list you write in Settings |
| Browser | Your real, signed-in Chrome | Headless Chromium, never signed in (public pages only) |
| Runs | When you open a tab | On a schedule (and on demand) |
| Output | One live page | Archive of editions, installable as a phone app (PWA) |
| Cost control | None | Per-build, per-day and per-month caps; max builds/day |

## Quick start

1. Push this repo to GitHub. The `image` workflow builds and publishes `ghcr.io/<you>/ai-homepage:latest` (typecheck, unit tests, server bundle and extension zip all run inside the Docker build).
2. Make the package public (GitHub → your profile → Packages → ai-homepage → Package settings → Change visibility), or give your host a pull token.
3. On the server: copy `compose.yml` and `.env.selfhost.example` (as `.env`), fill them in, then `docker compose up -d`.
4. Open the site, go to **Status → Build now**. The first build is manual on purpose; scheduled builds only start after one has succeeded.

## Configuration (environment)

| Variable | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Required to build. Never written to disk or shown in the UI. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Cloudflare Access: every request must carry a valid `Cf-Access-Jwt-Assertion` (checked against your team's JWKS, issuer and audience). Set both or neither. |
| `ADMIN_TOKEN` | ≥ 24 chars. `Authorization: Bearer …`, or visit `/?token=…` once (sets an HttpOnly cookie; needs HTTPS). |
| `ALLOW_INSECURE_NO_AUTH=1` | Only for localhost. Without any auth setting the server refuses to start. |
| `TZ` | Schedule, daily/monthly spend windows and "time of day" use this zone. |
| `GITHUB_TOKEN` | Optional; raises GitHub API limits for `github:` sources. |
| `NOTIFY_WEBHOOK_URL` | Optional JSON POST when a build fails or hits a cap. |
| `PRICING_JSON` | Optional override of the per-model price table in `src/pricing.ts`. |
| `HOST_PORT` | Compose only. Published on `127.0.0.1` so a tunnel/proxy is the only way in. |

`/healthz` is the only unauthenticated route and returns no data.

## Sources

One per line in Settings; `#` starts a comment; append `*1`…`*5` to weight a source.

```
hn                       # or hn:best, hn:new, hn:ask, hn:show
github:owner/repo        # releases; add #issues or #pulls
rss:https://example.com/feed.xml     # URLs that look like feeds are detected too
https://example.com/news             # any public page, rendered in headless Chromium
```

## Spend caps

Defaults: $1.50/build, $3/day, $30/month, 6 builds/day (all editable). The server meters every model request from the session event stream plus session runtime ($0.08/h, counted by wall-clock, so slightly high). A build is **aborted mid-flight** when it reaches `min(per-build cap, money left today, money left this month)`, and a build never starts if a limit is already used up. If the server dies mid-build the estimated cost is still recorded on the next start. Prices live in `apps/server/src/pricing.ts` (taken from the public pricing page on 2026-10-13); if Anthropic changes them, update that file or set `PRICING_JSON`.

## Security model

- Auth on every route except `/healthz`; state-changing requests also need a same-origin `Origin` and an `x-ah: 1` header (CSRF).
- The model's code is **never executed on the server**. It is bundled by esbuild with an import allowlist (only `react`), turned into a static HTML document and shown in an iframe with `sandbox` (no same-origin) plus a CSP of `connect-src 'none'` and a script hash, so a page can't read your data or phone home.
- Fetching URLs from inside your network is guarded: only public IPs, DNS answers checked, redirects re-checked, every browser sub-request checked, fresh cookie-less browser context per page. Known limit: DNS rebinding between the check and the connection; run the container without LAN access if that matters.
- Scraped content is untrusted: the agent is told to treat it as data, has no shell tool, and can only write the one output file.
- The container runs as a non-root user with all capabilities dropped and `no-new-privileges`.

## Cloudflare tunnel + Access (what this repo's author runs)

1. Deploy the compose stack so the app listens on `127.0.0.1:8088`.
2. Add a public hostname to the tunnel → `http://localhost:8088`, and a proxied CNAME to `<tunnel-id>.cfargotunnel.com`.
3. Put the hostname behind an Access application; copy its **Application Audience (AUD) tag** and your **team domain** into `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN`.

## Data

Everything lives in the `/data` volume: `settings.json`, `state.json` (cached agent/environment ids), `ledger.jsonl` (spend), `editions/<id>/{homepage.tsx,doc.html,meta.json}`. Back it up by copying the volume. Remote sessions and uploaded page copies are deleted after every build.

## Development

```bash
pnpm install
pnpm --filter @homepage/server test        # unit tests (node:test)
pnpm --filter @homepage/server typecheck
ANTHROPIC_API_KEY=… ADMIN_TOKEN=$(openssl rand -hex 16) DATA_DIR=./data pnpm --filter @homepage/server dev
```

Chromium for local development: `npx playwright-core install chromium`.
