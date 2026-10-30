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

Extract shared **`isBudgetOwner(who)`** from `budget/routes.ts` `ownerOk` (lines 30–32) into `budget/owner-access.ts` — **owner JWT + email only** (see `docs/command-palette/PLAN.md`). Subscription handlers live under `/api/budget/*`: check **`budgetAvailable(cfg)` first** (503 when gate off, same as `budget/routes.ts` lines 51–56), then **`isBudgetOwner(who)`** (403 when not owner).

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

1. **Load outflows:** `amount_cents < 0`, exclude rows with **`transfer_account_id` set** (column in migration v1, `budget/migrations.ts` line 72). Lookback **18 months** for weekly/monthly; yearly uses the same window (two charges ~1 year apart can still match).
2. **Payee split:** Group by `normalizePayee(payee)` first.
3. **Amount + billing-day split (same payee):** Do **not** merge unlike plans (e.g. Amazon $14.99 on the 3rd and $15.99 on the 20th). Within a payee:
   - Cluster amounts where each charge is within **`max(50 cents, 2%)`** of the cluster **median** absolute amount.
   - **Before** merging clusters, split by **billing day-of-month** (calendar day in workspace TZ): charges whose days differ by **> 3** days belong to different candidate subscriptions (or different cadence lanes).
   - Optionally split by detected cadence lane (weekly vs monthly) so a weekly and monthly charge at the same payee never merge.
4. **Cadence** (sorted dates per amount/day cluster):
   - **Weekly:** ≥3 dates; median gap 6–8 days; gap stdev **≤ 1.5 days**.
   - **Monthly:** ≥3 dates; median gap 27–33 days; gap stdev **≤ 4 days**.
   - **Yearly:** **2** dates with median gap **345–385 days** → eligible at **low** sample factor (see confidence); **≥3** dates in that band → **normal** confidence.
5. **Confidence** (explicit, clamp to `[0, 1]`):

   `gapScore = max(0, 1 - stdev(gaps) / median(gaps))` (0 if median gap is 0).

   `amountScore = fraction of charges within max(50¢, 2%) of cluster median`.

   `sampleScore = min(1, (n - 1) / 2)` for weekly/monthly (`n` = date count); for yearly use **`0.5` when n = 2**, **`1` when n ≥ 3**.

   **`confidence = gapScore × amountScore × sampleScore`**.

   **UI threshold (open Q1 default 0.7):** show pending detections only when `confidence ≥ 0.7`. With regular gaps and stable amounts, **3** monthly samples typically land ~0.85–1.0; **2** yearly samples cap near **0.5 × gapScore × amountScore**, so they stay hidden until Kellan lowers the threshold or a third charge arrives.

6. Emit `subscription_detections`; skip active subscriptions and **permanent** dismissals (same payee + amount cluster + billing-day lane).
7. **Dismiss:** `status = dismissed`, set `dismissed_at` — **permanent**.
8. **Logging:** `logBudgetError` only (`budget/redact.ts`).

**Next due date:** Store **`anchor_day_of_month`** (1–31) from the subscription anchor / confirmed detection. Advance from last matching transaction (or today) by cadence using **that anchor day**, not the last clamped due date. **Month-end:** when anchor day is 29–31, clamp each computed due date to the **last day of the target month** (helpers consistent with `validDay` / `cfg.tz`).

**Annual cost:** `amount_cents × {52, 12, 1}` by cadence.

---

## API routes

All routes: `budgetAvailable` (503 if false) + `isBudgetOwner` + existing budget store. JSON `cache-control: no-store`.

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
| Owner-only | `budgetAvailable` + `isBudgetOwner` | Extend `budget-routes-owner.test.ts` |
| Gate off | `budgetAvailable`, `/budget` 404 | `budget-gate.test.ts` |
| No payee in logs | `logBudgetError` | `budget-privacy.test.ts` |
| No LLM/MCP/briefing/ntfy | Import grep | `budget-privacy.test.ts` |
| PWA skip `/budget` | `pwa.ts` line 74 | SW assert |
| No subscription data in briefings | Not in `buildShutdownReview` | Static grep |

---

## Tests

**Unit:** `budget-subscriptions-detect.test.ts` (month-end due from anchor day; yearly 2-charge low confidence vs 3-charge; same-payee $14.99/@3 vs $15.99/@20 → two detections; confidence formula; dismiss permanent).

**Browser:** extend `budget.browser.ts` or `subscriptions.browser.ts`.

---

## PR breakdown

One PR: migration, `budget/subscriptions/detect.ts`, routes, `budget-page.ts` tab, tests.

---

## Open questions for Kellan

1. Keep default pending threshold **0.7** on the formula above, or show low-confidence yearly (2-sample) rows anyway?
2. Auto-link confirmed subscription to category via payee rules?
3. Monthly vs yearly label for annual plans billed monthly?
4. Re-scan every import vs manual Scan only?
5. **Dismiss:** keep permanent, or switch to 90-day suppress?

---

## Reference paths

- `docs/budget/PLAN.md`, `budget/gate.ts`, `budget/routes.ts`, `budget/migrations.ts` (`transfer_account_id`).
- `budget/csv.ts` `normalizePayee`; `budget/store.ts`; `auth.ts`; `owner-auth.ts` `OWNER_ACTION_FORBIDDEN`.
- `pwa.ts`; `http.ts` `send()` lines 134–136.
