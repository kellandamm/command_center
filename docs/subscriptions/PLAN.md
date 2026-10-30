# Subscriptions & recurring bills — implementation plan

**Owner-only** recurring spend on **Budget PR A** (on `main`: `budget.sqlite`, `budgetAvailable`, `handleBudgetRoutes`). Detect recurring payees from imported transactions; confirm, dismiss, or add manual entries. **Annual cost** and **next due date** (month-end aware). Same privacy as budget: no LLM, logs, push, briefing, or PWA cache.

**Out of scope:** bank sync, email triage, agent memory, budget alert ntfy.

**Cross-cutting:** no new dependencies or env vars; budget/subscription data never in briefings or push.

**Build order:** One dedicated subscriptions PR after Budget PR A; **Budget PR B** (rollup/panel) ships separately per `docs/budget/PLAN.md` and is **not** blocked on subscriptions.

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
| `subscription_detections` | `id`, `payee_normalized`, `amount_cents`, `cadence`, **`detection_kind`** (`standard` \| `possible_yearly`), `confidence`, `sample_dates_json`, `status`, `dismissed_at` nullable, `created_at` |

**Payee:** `normalizePayee` from `budget/csv.ts`.

---

## Detection algorithm (v1)

Run after `POST /api/budget/import/commit` and via `POST /api/budget/subscriptions/scan`:

1. **Load outflows:** `amount_cents < 0`, exclude rows with **`transfer_account_id` set** (`budget/migrations.ts` line 72). Lookback **18 months** for all cadences (no extended window for yearly).
2. **Payee split:** Group by `normalizePayee(payee)`.
3. **Cadence lanes first:** Within each payee, partition charges into **weekly**, **monthly**, and **yearly** candidate lanes using gap heuristics (do not merge across cadences). Amount clustering runs **inside each lane**: charges within **`max(50 cents, 2%)`** of the lane median belong together.
4. **Billing-day split (monthly and yearly lanes only):** Walk charges in date order; start a new sub-lane when the calendar day-of-month (in workspace `cfg.tz`) differs from the **previous charge in that lane** by **> 3 days**, using **circular month distance**: e.g. day **31** vs **1** is **1 day apart** (wrap across month-end), not 30. **Do not** apply billing-day split to **weekly** lanes (weekday spacing already defines weekly).
5. **Cadence rules** (per sub-lane):
   - **Weekly:** ≥3 dates; median gap 6–8 days; gap stdev **≤ 1.5 days** (if only one gap, **stdev = 0**).
   - **Monthly:** ≥3 dates; median gap 27–33 days; gap stdev **≤ 4 days** (single gap → **stdev = 0**).
   - **Yearly:** **2** dates with gap **345–385 days**, amounts within tolerance → **possible yearly** lane; **≥3** dates in that band → standard yearly lane.
6. **Confidence** (clamp `[0, 1]`):

   `gapScore = max(0, 1 - stdev(gaps) / median(gaps))` (if `median(gaps) === 0`, use 0; **one gap → stdev = 0 → gapScore = 1**).

   `amountScore` = fraction of charges within max(50¢, 2%) of lane median.

   `sampleScore`: weekly/monthly **`min(1, (n - 1) / 2)`**; yearly **`n ≥ 3` → 1**; yearly **possible (n = 2) → 0.9** (chosen so a strong 2-charge yearly clears the low threshold below).

   **`confidence = gapScore × amountScore × sampleScore`**.

7. **Thresholds (Kellan):**
   - **Standard pending rows:** `confidence ≥ **0.7**` (weekly/monthly and yearly with ≥3 samples).
   - **Possible yearly (2 charges, 345–385d, amount OK):** show when `confidence ≥ **0.45**` with UI badge **“Possible yearly — please confirm”** and `detection_kind = possible_yearly` (low-confidence yearly; confirm or dismiss).
8. Emit detections; skip active subscriptions and **permanent** dismissals (payee + amount cluster + lane identity).
9. **Dismiss:** permanent (`dismissed_at` set).
10. **Logging:** `logBudgetError` only.

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

Extend `apps/server/src/ui/budget-page.ts`: tab **`subscriptions`**, `statCard` / `emptyState` / `field()` from `components.ts`. Render **Possible yearly — please confirm** copy on `possible_yearly` rows (orange/warning styling per `#85` — destructive/warning token only).

**Nav:** Subscriptions live under existing **Budget** sidebar tab (`nav-tabs.ts` `id: budget`); no separate tab. Budget tab visibility unchanged (`visibleNavTabs` + owner gate).

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

**Unit:** `budget-subscriptions-detect.test.ts` — month-end due from anchor day; **weekly lane not split by billing-day rule**; **Jan 31 + Feb 1** stay one monthly/yearly lane (wrap distance 1); **2-charge yearly** surfaced as possible at **≥ 0.45**; **dual Amazon** $14.99/@3 vs $15.99/@20 remain two detections; confidence + permanent dismiss.

**Browser:** extend `budget.browser.ts` or `subscriptions.browser.ts` (possible-yearly label visible).

---

## PR breakdown

One PR: migration, `budget/subscriptions/detect.ts`, routes, `budget-page.ts` tab, tests.

---

## Decisions (Kellan)

1. **Thresholds:** Standard **`0.7`**; **possible yearly (2-charge)** uses **`0.45`** and dedicated UI copy — no longer lookback extension.
2. **Category on confirm:** Manual pick in UI; no auto-link from payee rules in v1.
3. **Annual billed monthly:** Detect as **monthly** cadence; user may re-label on confirm.
4. **Scan:** Run detector after each import commit **and** keep manual **Scan** button.
5. **Dismiss:** **Permanent.**

---

## Reference paths

- `docs/budget/PLAN.md`, `budget/gate.ts`, `budget/routes.ts`, `budget/migrations.ts` (`transfer_account_id`).
- `budget/csv.ts` `normalizePayee`; `budget/store.ts`; `auth.ts`; `owner-auth.ts` `OWNER_ACTION_FORBIDDEN`.
- `pwa.ts`; `http.ts` `send()` lines 134–136.
