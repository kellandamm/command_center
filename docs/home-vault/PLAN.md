# Home maintenance & documents vault — implementation plan

**Owner-only** maintenance reminders (ntfy + quiet hours) and a **documents/warranties vault**. Vault bytes and metadata **never** go to AI. Infra/env changes need Kellan’s approval (bottom)—agents document only until yes.

**Out of scope:** email triage, agent memory, direct bank connection, LLM on uploads, budget/subscription linkage.

**Cross-cutting:** no new dependencies or env vars in v1; budget data never in briefings or push (maintenance reminders are separate from budget alerts).

**Build order:** One PR after subscriptions (soft); may parallel goals once volume approved.

---

## Scope

| In | Out |
|----|-----|
| Reminders CRUD + ntfy tick hook | New `NTFY_*` schema |
| Owner file upload/download | Share links / inline browser viewing of vault bytes |
| Expiry UI | Briefing inclusion |
| Quiet-hours-aware sends via `notifyIfAllowed` | LLM extraction from PDFs |

---

## Data model

**SQLite:** `home.sqlite` under `cfg.dataDir` (`node:sqlite` `DatabaseSync`, same pattern as `board/store.ts` / `budget/db.ts`).

| Table | Purpose |
|-------|---------|
| `maintenance_items` | `id`, `title`, `notes`, `cadence_days`, `last_done_date`, `next_due_date`, `ntfy_enabled`, `pending_notify_after` (ISO instant when quiet hours blocked send), timestamps |
| `vault_documents` | `id`, `title`, `category`, `expiry_date`, **`storage_key`** (server UUID), `original_filename` (display only), `mime`, `size_bytes`, `sha256`, `uploaded_at` |

**Blob paths:** `{dataDir}/home-vault/blobs/{storage_key}` — **`storage_key` is server-generated** (UUID); client filename is **never** used in path segments. Create dirs via `ensureDirs(dataDir)` then `home-vault/blobs` with mode **0700**; blob files **0600** (`apps/server/src/store.ts` line 57 `ensureDirs`; budget DB uses `chmodSync` on sqlite in `budget/db.ts` lines 31–35).

**Limits:** 25 MB upload; max 500 documents / 200 maintenance items.

**Allowed types (magic-byte allowlist, not client `Content-Type` alone):** PDF, PNG, JPEG, **HEIC/HEIF**, WebP; **`text/plain` stored and served as attachment-only** (never `inline`). Reject on content-type spoofing.

**Upload parsing:** Reuse multipart/body parsing patterns from `apps/server/src/voice-capture/parse-body.ts` (`parseMultipartForm` / `readRawBody`) — **no new npm dependency**; add a vault-specific wrapper with vault size/MIME limits.

---

## API routes

Gate: **`homeVaultAvailable(cfg)`** — same triple as `budgetAvailable` (`budget/gate.ts`). **`who.owner === true`** for all vault bytes; reject admin-token for downloads (stricter than settings).

| Method | Path | Notes |
|--------|------|-------|
| CRUD | `/api/home/maintenance/*` | JSON no-store |
| Upload | `POST /api/home/vault/documents` | Multipart → UUID `storage_key` |
| Download | `GET /api/home/vault/documents/:id/file` | **Streamed** (not `send()` at `http.ts:134`) |

### Safe download response (required)

For `GET .../file`, use `res.writeHead` + stream body with:

- **`Content-Disposition: attachment`** always — never `inline`. ASCII fallback filename + **RFC 5987** `filename*=UTF-8''…` from sanitized `original_filename` or `title`.
- **`Content-Type`** from stored allowlisted MIME (from magic bytes at upload).
- **`X-Content-Type-Options: nosniff`** (global `SECURITY` in `http.ts` lines 127–131 applies to `send()` only; streamed downloads must set it explicitly).
- **`Cache-Control: no-store`**.

Resolve `storage_key` only from DB row; reject `..`, slashes, or mismatched keys (**path traversal** test).

When gate off: **503** JSON, **404** `/home` page.

---

## Notifications

In `apps/server/src/notify/tick.ts` (with calendar reminders):

1. Items due where `ntfy_enabled` and `next_due_date <= today` in `cfg.tz`.
2. Call **`notifyIfAllowed`** (`notify/ntfy.ts` lines 166–168), which applies **`shouldSendDuringQuietHours`** (`notify/ntfy.ts` lines 132–134) before **`notify`**.
3. If due but quiet hours block: set **`pending_notify_after`** to the **end of the current quiet window** in workspace TZ (preferred over dropping); on subsequent ticks when `now >= pending_notify_after`, send and clear pending. Digest bypass in `tick.ts` (~line 67) does **not** apply to maintenance.
4. Resolve config with **`resolveNtfyConfig(deployment, effective)`** (`notify/ntfy.ts` line 106), same as `http.ts` ntfy test/status routes.

Generic title/body only—no filenames or receipt amounts in ntfy body.

---

## UI

`apps/server/src/ui/home-vault-page.ts` — `/home?view=maintenance|vault`; `#85` components.

**PWA:** extend `pwa.ts` line 74 guard for `/home` and `/home/` (mirror `/budget`).

---

## Privacy and security

| Rule | Enforcement | Test |
|------|-------------|------|
| Owner-only bytes | Gate + owner JWT | `home-vault-owner.test.ts` |
| Download attachment + nosniff | Stream headers | Header unit test |
| Path traversal | UUID keys only | `storage_key=../etc/passwd` → 404 |
| Content-type spoofing | Magic-byte allowlist | Upload `.pdf` that is executable → reject |
| No vault in LLM/MCP | `home/excluded.ts` | Grep |
| No bytes in logs | Code-only errors | Privacy test |

---

## Tests

**Unit:** `home-vault-upload.test.ts`, `home-vault-download.test.ts` (attachment, nosniff, traversal), `home-maintenance-quiet.test.ts` (defer to quiet end).

**Browser:** `home-vault.browser.ts` in `test:dashboard-browser`.

---

## PR breakdown

Single PR: `home/` module, `ui/home-vault-page.ts`, `notify/tick.ts` hook, `pwa.ts`, `http.ts`, tests.

---

## Needs Kellan’s approval

| Change | Why |
|--------|-----|
| `home-vault/blobs/` on `homepage-data` | Backup size |
| `home.sqlite` in `SELFHOST.md` | Ops |
| `compose.yml` extra mount (if not using `DATA_DIR`) | Infra |
| Upload cap / MIME expansion | Security |
| Optional `HOME_VAULT_*` env | New config—flag only |

---

## Open questions for Kellan

1. Nav tab “Home” vs Settings-only link?
2. Seed default maintenance templates?
3. ntfy `click` URL via `appPublicUrl` → `/home?view=maintenance`?
4. Warranty expiry warning lead (30/60/90 days)?

---

## Reference paths

- `apps/server/src/budget/gate.ts` `budgetAvailable` (gate pattern on `main`).
- `apps/server/src/store.ts` `ensureDirs` (line 57).
- `apps/server/src/voice-capture/parse-body.ts` (multipart parsing, no new deps).
- `apps/server/src/notify/ntfy.ts` `resolveNtfyConfig`, `notifyIfAllowed`, `shouldSendDuringQuietHours`.
- `apps/server/src/notify/tick.ts`, `notify/quiet-hours.ts`.
- `apps/server/src/http.ts` `send()` / `SECURITY` (line 134); streamed downloads set same nosniff.
- `apps/server/src/pwa.ts` line 74.
