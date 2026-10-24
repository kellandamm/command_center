# Expiring read-only note share links

This feature lets the **owner** create encrypted, read-only snapshots of a single note. Decryption happens only in the visitor’s browser using a 256-bit AES-GCM key carried in the URL **fragment** (`#…`). The server stores **ciphertext and IV only** and never sees the key or plaintext.

**The feature is unusable in production until Cloudflare Zero Trust is configured as below.** It ships **disabled** until `SHARE_LINKS_ENABLED=1` is set on the server.

## Server environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `SHARE_LINKS_ENABLED` | off (`0`) | Master switch. Leave off until Access bypass is in place. |
| `SHARE_LINKS_MAX_ACTIVE` | `50` | Maximum concurrent non-expired shares. |
| `SHARE_LINKS_MAX_CIPHERTEXT_BYTES` | `512000` | Encrypted payload size cap per share. |
| `SHARE_LINKS_RATE_LIMIT_PER_MINUTE` | `60` | Per-IP limit on `/share/*` and `/assets/share-viewer.js`. |

## Cloudflare Zero Trust (Infra Ops)

Command Center is normally protected by a Cloudflare Access application on the main hostname (e.g. `command.gobison.io`). Share links must be readable **without** an Access JWT on **only** these paths:

- `GET /share/<id>` (HTML viewer)
- `GET /share/<id>/data` (ciphertext JSON)
- `GET /assets/share-viewer.js` (public decrypt script)

Everything else must **remain** behind Access unchanged.

### Recommended configuration

1. **Add a separate Access application** (or a more specific path rule) for:
   - **Application domain:** `command.gobison.io`
   - **Path:** `/share/*` (and ensure `/assets/share-viewer.js` is covered if your main app policy does not already allow it without JWT — typically add a second path rule or include `/assets/share-viewer.js` on the bypass app).

2. **Policy:** **Bypass** (allow everyone) for that application only.

3. **Precedence:** The bypass application for `/share/*` must be **evaluated before** (higher precedence than) the main “require login” application for `command.gobison.io/*`. If order is wrong, visitors will get an Access login page instead of the share viewer.

4. **Scope check:** Confirm no other paths are included in the bypass policy (no `/*`, no `/api/*`, no `/notes`). Only the share prefix and the single public script asset.

5. **Enable the feature:** Set `SHARE_LINKS_ENABLED=1` on the Command Center deployment and redeploy/restart.

### Verify

From a network **without** an Access session cookie or service token:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "https://command.gobison.io/share/INVALIDIDAAAAAAAAAAAAAA"
# Expect 404 (not 302 to Access login)

curl -sS -o /dev/null -w "%{http_code}\n" "https://command.gobison.io/api/settings"
# Expect 302/401 — still protected
```

Create a real share from the Notes UI as owner, open the full URL (including `#`) in a private window, and confirm the note renders.

### Roll back

1. Set `SHARE_LINKS_ENABLED=0` (or unset) and restart Command Center — owner UI hides share actions; public routes return 404.
2. Remove or disable the Access **Bypass** application for `/share/*` (restore single main Access app).
3. Optionally delete `share-links.json` in the server data directory to remove stored ciphertext.

## Security notes

- Anyone with the full URL (including `#`) can read the snapshot until expiry or revoke.
- Fragments are not sent to the server on navigation, but may appear in browser history; treat links like passwords.
- Notes marked `sensitive` (when that field exists on `KnowledgeNote`) cannot be shared.
