# Tesella

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

To check the server end to end (two guest bots play a whole private-room match):

```bash
npm run test:match --prefix server
```

## Deploying to Cloudflare (recommended)

The same game server runs as a Cloudflare Worker (`cloudflare/worker.js`) with one Durable Object (`cloudflare/game.js`) that holds every room, match and account. Accounts are stored in the Durable Object's own database, so they survive deploys. `wrangler.jsonc` has the whole setup.

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → choose this repository.
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler deploy`
2. After the first deploy, open the Worker → **Settings → Variables and Secrets** and add:
   - `RESEND_API_KEY` (type *Secret*)
   - `MAIL_FROM`, e.g. `Tesella <no-reply@yourdomain.com>`
   - Optional: `GOOGLE_CLIENT_ID`
3. Try it on the `*.workers.dev` address, then add your domain under **Settings → Domains & Routes → Custom domain** (remove any old DNS records for that name first).

To run the Cloudflare version locally:

```bash
npm run cf:dev        # builds the client, then serves everything on :8787
```

Notes:

- **Deploys don't wipe accounts**, but they do restart the game, so matches in progress end (ratings unaffected). Deploy at quiet times.
- The client sends a small keepalive every 25 s; Cloudflare closes sockets that are silent for about 100 s.
- To check a deployment end to end: `URL=wss://your-domain/ws npm run test:match --prefix server`.

## Deploying to Render

`render.yaml` describes the whole deployment: one web service that builds the client, serves it, and runs the multiplayer server, plus a 1 GB disk for accounts.

1. **Resend:** add and verify your domain in Resend, then create an API key.
2. **Render:** Dashboard → New → Blueprint → choose this repository. When asked, fill in:
   - `RESEND_API_KEY`: the key from step 1
   - `MAIL_FROM`: e.g. `Tesella <no-reply@yourdomain.com>` (must be on the verified domain)
3. Deploy. Render terminates HTTPS, so the game connects over `wss://` automatically.
4. Optional: add your own domain under the service's Settings → Custom Domains.

Things that matter:

- **The disk needs a paid instance** (the Blueprint uses `starter`). On the free plan the service sleeps when idle and every deploy starts with no accounts.
- **Accounts live in `/var/data/data.json`**, with hourly backups (last 48) in `/var/data/backups`. If the file is ever damaged, the server sets it aside and restores the newest backup automatically.
- **Every deploy restarts the server.** Ranked matches in progress at that moment are abandoned without affecting ratings, and players are told so. Deploy at quiet times.
- **Fill in the privacy and terms pages** (`public/privacy.html`, `public/terms.html`): replace every `[BRACKETED]` item before launch.

## Site, T-Terminal and the API

One build serves the game and the site around it, all in the same pixel theme:

| Path | What |
| --- | --- |
| `/` | the game |
| `/terminal` | **T-Terminal** (blue): player search, rankings, player records. Also served at the root of any `terminal.*` host, e.g. `terminal.tesella.io`. |
| `/about`, `/news`, `/download`, `/help` | site pages, each in its own colour (`src/site/`) |
| `/privacy`, `/terms` | legal pages |

T-Terminal and the in-game profile popups read a public, read-only JSON API (`server/api.js`): `/api/overview`, `/api/leaderboard?page=N`, `/api/search?q=…`, `/api/player/NAME`. It never returns emails or account details, and lists only players with a verified email.

The version shown beside every title comes from `package.json`. Bump it there with each release, and add a note to `NEWS` in `src/site/pages.jsx`.

Chat in online matches is relayed by the server and never stored. It is cleaned, limited to 120 characters and rate-limited; words in `server/blocklist.txt` are masked.

## Server settings

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY`, `MAIL_FROM` | Sending codes by email. Required when `NODE_ENV=production`. |
| `DATA_DIR` | Where `data.json` and `backups/` live. |
| `TRUST_PROXY` | Set when behind a proxy (`1` on Render). The visitor's address is then read from `CF-Connecting-IP`, which Render's Cloudflare layer sets. Open `/whoami` to see the address the server counts you as. |
| `PORT` | Set by Render. |

Abuse limits (in `server/limits.js`): 10 successful sign-ups an hour per IP, 5 emails an hour per IP and 8 a day per account, login throttling per IP and per username, 8 connections per IP, 16 KB per message, and about 20 messages a second per connection. Words banned from names go in `server/blocklist.txt`.
