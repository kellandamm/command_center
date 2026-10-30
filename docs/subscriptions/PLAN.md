# Subscriptions & recurring bills — implementation plan

**Owner-only** recurring spend on **Budget PR A** (on `main`: `budget.sqlite`, `budgetAvailable`, `handleBudgetRoutes`). Detect recurring payees from imported transactions; confirm, dismiss, or add manual entries. **Annual cost** and **next due date** (month-end aware). Same privacy as budget: no LLM, logs, push, briefing, or PWA cache.

**Out of scope:** bank sync, email triage, agent memory, budget alert ntfy.

**Cross-cutting:** no new dependencies or env vars; budget/subscription data never in briefings or push.

**Build order:** One dedicated subscriptions PR after Budget PR A (may follow Budget PR B if convenient).

---

## Scope

| In | Out |
|----|-----|
| Migration on `budget.sqlite` | New auth env vars |
| Detection on import commit + manual Scan | Briefing / shutdown / ntfy |
| `/budget?view=subscriptions` | Todoist / board linkage |
| Confirm / dismiss / manual CRUD | LLM categorization |

---

## Owner check

Extract shared **`isBudgetOwner`** from `budget/routes.ts` `ownerOk` (lines 30–32) into `budget/owner-access.ts` (see `docs/command-palette/PLAN.md`). Subscriptions routes use the same helper as budget JSON and palette—not a separate `requireBudgetOwner`.

---

## Data model

Migration on **`budget.sqlite`** (`openBudgetDatabase` in `budget/db.ts`, `chmod 0600` on DB file):

| Table | Columns (v1) |
|-------|----------------|
| `subscriptions` | `id`, `payee_normalized`, `display_name`, `amount_cents`, `currency`, `cadence`, `anchor_date`, `category_id`, `active`, `source`, timestamps |
| `subscription_detections` | `id`, `payee_normalized`, `amount_cents`, `cadence`, `confidence`, `sample_dates_json`, `status`, `dismissed_at` nullable, `created_at` |

**Payee:** `normalizePayee` from `budget/csv.ts`.

---

## Detection algorithm (v1)

Run after `POST /api/budget/import/commit` and via `POST /api/budget/subscriptions/scan`:

1. **Load outflows:** `amount_cents < 0`, exclude rows with **`transfer_account_id` set** (column in migration v1, `budget/migrations.ts` line 72).
2. **History window:** **18 months** for weekly/monthly; **≥ 25 months** of data required before **yearly** inference (three charges in 18 months cannot satisfy yearly).
3. **Amount clustering:** Do **not** use `round(amount / tolerance)` bucketing (collapses all charges ≥ ~$50 into one bucket). Group by `normalizePayee(payee)` first; within each payee, cluster amounts where every member is within **`max(200 cents, 5% of cluster median)`** of the median absolute amount.
4. **Cadence** (sorted dates per cluster):
   - **Weekly:** ≥3 dates, median gap 6–8 days, low spread.
   - **Monthly:** ≥3 dates, median gap 27–33 days.
   - **Yearly:** ≥2 dates with median gap 350–380 days **or** ≥3 yearly-spaced dates; yearly detections at **lower confidence** when only 2 samples.
5. Emit `subscription_detections` with confidence 0–1. Skip active subscriptions and **permanent** dismissals (same payee + amount cluster).
6. **Dismiss:** `status = dismissed`, set `dismissed_at` — **permanent** (no 90-day resurrection). Kellan can override via open question if time-boxed dismiss is preferred.
7. **Logging:** `logBudgetError` only (`budget/redact.ts`).

**Next due date:** Step from last matching transaction (or today) by cadence. **Month-end:** for `monthly`, if anchor day is 29–31, clamp scheduled due to **last day of month** when the target month is shorter (use workspace calendar date helpers consistent with `validDay` / `cfg.tz`).

**Annual cost:** `amount_cents × {52, 12, 1}` by cadence.

---

## API routes

All routes: `isBudgetOwner` + existing budget store. JSON `cache-control: no-store`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/budget/subscriptions` | Active + pending detections |
| POST | `/api/budget/subscriptions` | Manual create |
| PUT | `/api/budget/subscriptions/:id` | Edit / deactivate |
| POST | `/api/budget/subscriptions/detections/:id/confirm` | Promote |
| POST | `/api/budget/subscriptions/detections/:id/dismiss` | Permanent dismiss |
| POST | `/api/budget/subscriptions/scan` | Re-run detector |

Non-owner / gate off: **403/503** like budget; nav budget tab filtered via `visibleNavTabs(..., { budget: ... })` (`nav-tabs.ts`).

---

## UI

Extend `apps/server/src/ui/budget-page.ts`: tab **`subscriptions`**, `statCard` / `emptyState` / `field()` from `components.ts`.

---

## Privacy and security

| Rule | Where | Test |
|------|-------|------|
| Owner-only | `isBudgetOwner` | Extend `budget-routes-owner.test.ts` |
| Gate off | `budgetAvailable`, `/budget` 404 | `budget-gate.test.ts` |
| No payee in logs | `logBudgetError` | `budget-privacy.test.ts` |
| No LLM/MCP/briefing/ntfy | Import grep | `budget-privacy.test.ts` |
| PWA skip `/budget` | `pwa.ts` line 74 | SW assert |
| No subscription data in briefings | Not in `buildShutdownReview` | Static grep |

---

## Tests

**Unit:** `budget-subscriptions-detect.test.ts` (month-end due, yearly 25mo window, amount clusters, dismiss permanent).

**Browser:** extend `budget.browser.ts` or `subscriptions.browser.ts`.

---

## PR breakdown

One PR: migration, `budget/subscriptions/detect.ts`, routes, `budget-page.ts` tab, tests.

---

## Open questions for Kellan

1. Minimum confidence to show pending (default 0.7)?
2. Auto-link confirmed subscription to category via payee rules?
3. Monthly vs yearly label for annual plans billed monthly?
4. Re-scan every import vs manual Scan only?
5. **Dismiss:** keep permanent, or switch to 90-day suppress?

---

## Reference paths

- `docs/budget/PLAN.md`, `budget/gate.ts`, `budget/routes.ts`, `budget/migrations.ts` (`transfer_account_id`).
- `budget/csv.ts` `normalizePayee`; `budget/store.ts`; `auth.ts`; `owner-auth.ts` `OWNER_ACTION_FORBIDDEN`.
- `pwa.ts`; `http.ts` `send()` lines 134–136.
