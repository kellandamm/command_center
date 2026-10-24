# Expiring read-only note share links

This feature lets the **owner** create encrypted, read-only snapshots of a single note. Decryption happens only in the visitor’s browser using a 256-bit AES-GCM key carried in the URL **fragment** (`#…`). The server stores **ciphertext and IV only** and never sees the key or plaintext.

**The feature is unusable in production until Cloudflare Zero Trust is configured as below.** It ships **disabled** until `SHARE_LINKS_ENABLED=1` is set on the server.

## Server environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `SHARE_LINKS_ENABLED` | off (`0`) | Master switch. Leave off until Access bypass is in place. |
| `SHARE_LINKS_MAX_ACTIVE` | `50` | Maximum concurrent non-expired shares. |
| `SHARE_LINKS_MAX_CIPHERTEXT_BYTES` | `512000` | Encrypted payload size cap per share. |
| `SHARE_LINKS_RATE_LIMIT_PER_MINUTE` | `60` | Per-IP limit on `/share/*` (app-enforced). |

The app rate-limits using `CF-Connecting-IP` when present. **Only trust that header if the origin is reachable exclusively through Cloudflare** (no direct-to-origin IP); otherwise clients could spoof IPs.

## Cloudflare Zero Trust (Infra Ops)

Command Center is normally protected by a Cloudflare Access **self-hosted** application on `command.gobison.io` (apex or path empty / `/*`), with Allow policies for your identity.

Share links must work **without** an Access JWT on everything under **`/share/`** only:

- `GET /share/<id>` (HTML viewer)
- `GET /share/<id>/data` (ciphertext JSON)
- `GET /share/viewer.js` (public decrypt script)

All other paths (`/api/*`, `/notes`, etc.) must keep using the existing Access application.

### How overlapping applications work

Cloudflare Access does **not** use a manual “precedence” list between applications. When a request matches more than one self-hosted application on the same hostname, the **more specific path** wins and does **not** inherit the parent application’s policy. See [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).

Use a **second** self-hosted application for the public share tree so it can use **Bypass** while the main app stays protected.

### Dashboard steps

1. **Zero Trust** → **Access controls** → **Applications** → **Add an application** → **Self-hosted**.
2. **Application name:** e.g. `Command Center — public share links`.
3. **Session duration:** your choice (Bypass still applies at the edge).
4. Under **Add public hostname** (or **Application domains**):
   - **Subdomain:** `command` (or leave blank if the UI uses the full hostname `command.gobison.io`).
   - **Domain:** `gobison.io` (your zone).
   - **Path:** `/share/*`  
     Per Cloudflare’s path rules, `/share/*` matches URLs **under** `/share/` (e.g. `/share/viewer.js`, `/share/<id>/data`). It does **not** match the apex or unrelated paths. Do **not** use an empty path or `/*` on this app.
5. **Policies** → **Add a policy**:
   - **Action:** **Bypass**
   - **Rule:** **Everyone** (or equivalent include-all rule).
6. Leave your **existing** `command.gobison.io` Access application (broader path) unchanged with its normal Allow policies.
7. Set `SHARE_LINKS_ENABLED=1` on Command Center and redeploy/restart.

### Optional: WAF rate limiting

In **Security** → **WAF** → **Rate limiting rules** (or **Custom rules**), add a rule scoped to:

- **Hostname:** `command.gobison.io`
- **URI path** starts with `/share/`

Example: block or challenge when requests exceed N per minute per IP. This complements the app’s `SHARE_LINKS_RATE_LIMIT_PER_MINUTE` and protects the origin if Access is misconfigured.

### Verify

From a network **without** an Access session:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "https://command.gobison.io/share/viewer.js"
# Expect 200 when SHARE_LINKS_ENABLED=1 (not an Access login redirect)

curl -sS -o /dev/null -w "%{http_code}\n" "https://command.gobison.io/api/settings"
# Expect 302/401 — still protected

curl -sS -o /dev/null -w "%{http_code}\n" "https://command.gobison.io/share/INVALIDIDAAAAAAAAAAAAAA"
# Expect 404 from the app (not Access), when the feature is enabled
```

Create a real share from the Notes UI as owner, open the full URL (including `#`) in a private window, and confirm the note renders.

### Roll back

1. Set `SHARE_LINKS_ENABLED=0` (or unset) and restart Command Center.
2. Delete or disable the **Bypass** Access application for `/share/*` only.
3. Optionally delete `share-links.json` in the server data directory.

## Security notes

- Anyone with the full URL (including `#`) can read the snapshot until expiry or revoke.
- Fragments are not sent to the server on navigation, but may appear in browser history; treat links like passwords.
- Notes with `sensitive: true` on the stored record (once supported in a separate change) cannot be shared.
