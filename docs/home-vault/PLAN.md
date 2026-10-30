# Home maintenance & documents vault — implementation plan

**Owner-only** home maintenance reminders (ntfy, respecting quiet hours) plus a **documents/warranties vault** (manuals, receipts, warranties with expiry). Vault files and metadata **never** go to AI. Storage, limits, and backups are specified here; **infra changes require Kellan’s approval** (see bottom)—do not apply in agent runs without sign-off.

**Out of scope:** email triage, agent memory, direct bank connection, LLM extraction from PDFs, budget/subscription linkage.

**Build order:** One implementation PR after subscriptions (soft dependency: none hard); can parallelize with goals if vault volume approved.

---

## Scope

| In | Out |
|----|-----|
| Reminders CRUD + ntfy tick hook | Changing `NTFY_*` env schema (use existing `resolveNtfy` in `notify/ntfy.ts`) |
| File upload/download for owner | Public or share-link access to vault blobs |
| Expiry tracking + “expiring soon” UI | Sending vault filenames to `chatCompletion` |
| Quiet-hours-aware reminder sends | Briefing/digest inclusion |

---

## Data model

**SQLite:** `home.sqlite` under `cfg.dataDir` (same volume pattern as `budget.sqlite` in `docs/budget/PLAN.md` / `rss.sqlite` via `board/store.ts` `DatabaseSync` + dedicated file).

| Table | Purpose |
|-------|---------|
| `maintenance_items` | `id`, `title`, `notes` (plain, max 2k), `cadence_days`, `last_done_date`, `next_due_date`, `ntfy_enabled`, `created_at`, `updated_at` |
| `vault_documents` | `id`, `title`, `category` (`manual` \| `receipt` \| `warranty` \| `other`), `expiry_date` nullable, `storage_key`, `mime`, `size_bytes`, `sha256`, `uploaded_at` |

**Blob storage on disk:** `{dataDir}/home-vault/blobs/{storage_key}` — content-addressed or uuid filenames; **`chmod 0600`** files, **`0700`** dirs (mirror `budget/store.ts` `ensureDirs` intent from budget plan).

**Limits (v1 defaults):**

| Limit | Value |
|-------|-------|
| Max upload size | **25 MB** per file (`readRawBody` / multipart cap aligned with `request-body.ts` patterns) |
| Allowed MIME | `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `text/plain` |
| Max documents | **500** active rows |
| Max maintenance items | **200** |

---

## API routes

Gate: **`who.owner === true`** and same triple as budget—`cfg.cfTeamDomain`, `cfg.cfAud`, `cfg.ownerEmails` (`budget/gate.ts` `budgetAvailable` pattern). Reuse helper name `homeVaultAvailable(cfg)` in `home/gate.ts` (parallel module, do not merge with budget gate logic).

| Method | Path | Notes |
|--------|------|-------|
| GET/POST/PUT/DELETE | `/api/home/maintenance/*` | CRUD; JSON no-store |
| GET/POST/DELETE | `/api/home/vault/documents/*` | Upload via `POST` multipart; download `GET .../file` streams with `Content-Disposition` |
| POST | `/api/home/vault/documents/:id/expiry` | Set expiry |

When gate off: **503** JSON, **404** for `/home` page; no nav tab (`nav-tabs.ts`).

**Auth:** owner JWT only—**not** `canManageSharedServerState` (`owner-auth.ts`); reject admin-token for vault bytes (stricter than settings).

---

## Notifications

Hook in `apps/server/src/notify/tick.ts` (same tick as calendar reminders):

1. Select maintenance items where `ntfy_enabled`, `next_due_date <= today` (workspace `cfg.tz`), not notified in last 24h (dedupe key in sqlite or json state file under data dir).
2. Call `shouldSendDuringQuietHours` (`notify/ntfy.ts` lines 132–134) — **respect** `NTFY_QUIET_HOURS` + `parseQuietHours` / `inQuietHours` (`notify/quiet-hours.ts`).
3. Use `publishNtfy` with title only (item title + “due today”); **no** attachment paths or expiry amounts in body if they reveal purchases—optional generic copy.

Morning briefing digest bypass (`notify/tick.ts` comment line 67) does **not** apply to maintenance—still respect quiet hours.

**No** budget-style alerts in briefings.

---

## UI

| Piece | Files |
|-------|-------|
| Page | `apps/server/src/ui/home-vault-page.ts` — `/home?view=maintenance|vault` query pattern like `sources-page.ts` / budget views |
| Components | `#85` `pageHeader`, `field`, `emptyState`, `badge` (expiry warning → **orange/destructive** token only for expired) |
| Upload | Owner-only form; show expiry date picker for warranties |

**PWA:** extend `pwa.ts` `SERVICE_WORKER` fetch guard to skip **`/home`** and **`/home/`** (same line pattern as budget plan for `/budget`).

---

## Privacy and security

| Rule | Enforcement | Test |
|------|-------------|------|
| Owner-only binary + metadata | Routes check `who.owner` + gate | `home-vault-owner.test.ts` |
| No vault in LLM/MCP | `home/excluded.ts`; grep | Snapshot |
| No document bytes in logs | Error codes only | Privacy test |
| No AI on upload | No import of vault into `llm/` | Grep |
| SSRF on upload | Magic-byte sniff + MIME allowlist | Unit |
| Backups | Document in `SELFHOST.md` when shipping (see Needs approval) | Docs review |

---

## Tests

**Unit:** `home-maintenance.test.ts` (cadence → next due), `home-vault-upload.test.ts` (size/MIME reject), `home-gate.test.ts`, `home-privacy.test.ts`.

**Browser:** `home-vault.browser.ts` in `test:dashboard-browser` — owner upload flow; non-owner 403 on API.

---

## PR breakdown

Single PR: `home/` module (gate, store, routes, maintenance scheduler), `ui/home-vault-page.ts`, `notify/tick.ts` hook, `pwa.ts` skip, `http.ts` + `index.ts` wire, tests, **SELFHOST.md** backup bullet (text only in docs PR if infra not approved yet).

---

## Needs Kellan’s approval (do not apply without explicit yes)

| Change | Why |
|--------|-----|
| New **`home-vault/` blob directory** on `homepage-data` volume | Docker volume size / backup scope |
| **`home.sqlite`** backup line in `SELFHOST.md` + restore procedure | Ops |
| **`compose.yml` / volume mount** if separate mount desired (default: reuse `DATA_DIR`) | Infra |
| Raising **25 MB** upload cap or adding MIME types | Security surface |
| Optional **`HOME_VAULT_MAX_BYTES`** env (new) | Config policy—flag only, default unset |

Agent/cloud runs: **document only** until approved.

---

## Open questions for Kellan

1. Separate nav tab “Home” vs nested under Settings?
2. Default maintenance templates (HVAC filter, smoke detector battery) seeded on first open?
3. ntfy click URL → `/home?view=maintenance` using `appPublicUrl` (`config.ts`)?
4. Warranty expiry lead time (30/60/90 days) for UI warnings?

---

## Reference paths (existing)

- SQLite file pattern: `apps/server/src/board/store.ts`, `apps/server/src/wins/store.ts` (`node:sqlite` `DatabaseSync`).
- Owner check pattern: `apps/server/src/auth.ts`, `apps/server/src/owner-auth.ts`.
- Budget gate reference: `docs/budget/PLAN.md`, `budget/gate.ts` (historical PR A).
- Ntfy + quiet hours: `apps/server/src/notify/ntfy.ts`, `notify/quiet-hours.ts`, `notify/tick.ts`.
- Config TZ / ntfy: `apps/server/src/config.ts` `tz`, `ntfyQuietHours`.
- PWA: `apps/server/src/pwa.ts`.
- Raw body limits: `apps/server/src/request-body.ts`.
