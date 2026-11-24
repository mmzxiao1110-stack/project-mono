# MINO

A simultaneous-turn territory game for the browser. Solo against an AI, pass-and-play, or ranked online.

- `src/`: the React client
- `shared/`: game rules, used by both client and server
- `server/`: accounts, matchmaking and authoritative ranked matches over WebSocket
- `public/`: static files, including the `privacy` and `terms` pages

## Running locally

```bash
npm install
npm install --prefix server
cp server/.env.example server/.env
```

In two terminals:

```bash
npm run dev --prefix server   # game server on :8787
```

```bash
npm run dev                   # client on :5173
```

Without `RESEND_API_KEY`, verification and password-reset codes are printed in the server terminal.

To check the server end to end (with `SKIP_EMAIL_VERIFY=1` in `server/.env`):

```bash
npm run test:match --prefix server
```

## Deploying to Render

`render.yaml` describes the whole deployment: one web service that builds the client, serves it, and runs the multiplayer server, plus a 1 GB disk for accounts.

1. **Resend:** add and verify your domain in Resend, then create an API key.
2. **Render:** Dashboard → New → Blueprint → choose this repository. When asked, fill in:
   - `RESEND_API_KEY`: the key from step 1
   - `MAIL_FROM`: e.g. `MINO <no-reply@yourdomain.com>` (must be on the verified domain)
3. Deploy. Render terminates HTTPS, so the game connects over `wss://` automatically.
4. Optional: add your own domain under the service's Settings → Custom Domains.

Things that matter:

- **The disk needs a paid instance** (the Blueprint uses `starter`). On the free plan the service sleeps when idle and every deploy starts with no accounts.
- **Accounts live in `/var/data/data.json`**, with hourly backups (last 48) in `/var/data/backups`. If the file is ever damaged, the server sets it aside and restores the newest backup automatically.
- **Every deploy restarts the server.** Ranked matches in progress at that moment are abandoned without affecting ratings, and players are told so. Deploy at quiet times.
- **Don't set `SKIP_EMAIL_VERIFY` on the live service** unless it's a closed test: it lets anyone sign up with any email.
- **Fill in the privacy and terms pages** (`public/privacy.html`, `public/terms.html`): replace every `[BRACKETED]` item before launch.

## Server settings

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY`, `MAIL_FROM` | Sending codes by email. Required when `NODE_ENV=production`. |
| `DATA_DIR` | Where `data.json` and `backups/` live. |
| `TRUST_PROXY` | Set when behind a proxy (`1` on Render). The visitor's address is then read from `CF-Connecting-IP`, which Render's Cloudflare layer sets. Open `/whoami` to see the address the server counts you as. |
| `SKIP_EMAIL_VERIFY` | `1` lets unverified accounts play ranked. Local testing only. |
| `PORT` | Set by Render. |

Abuse limits (in `server/limits.js`): 10 successful sign-ups an hour per IP, 5 emails an hour per IP and 8 a day per account, login throttling per IP and per username, 8 connections per IP, 16 KB per message, and about 20 messages a second per connection. Words banned from names go in `server/blocklist.txt`.
