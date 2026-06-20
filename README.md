# Portfolio Dashboard

Self-hosted multi-wallet Solana portfolio tracker.

- **Token holdings** with prices, balances, USD values
- **DeFi positions** across major protocols (Kamino, Drift, Exponent, …)
- **Trade-based P&L** — cost basis derived from on-chain swap history, with transfer-in pricing from historical Birdeye data when the token entered the wallet via transfer
- **Returns summary** — Current Value, Invested, Absolute Return, XIRR (annualized)
- **Trade History panel** — every priced buy/sell with links out to a block explorer
- **Portfolios** — group multiple wallets and track them together (a "household"); cost basis follows tokens across your wallets
- **Per-portfolio tracker chart** — net-worth snapshots accumulate as you open the dashboard

**State lives in the browser.** Portfolios, snapshots, connected-wallet, search history — all in `localStorage`. The server has no database, no auth, no paid tier; it only proxies third-party APIs and computes derived data like XIRR.

## Stack

- Node.js + Express backend
- Vanilla JS / HTML / CSS frontend (single `public/index.html`)
- Docker
- Optional Telegram webhook for signup/usage pings

## Quick start

```bash
cp .env.example .env       # fill in the four required API keys
npm install
npm run dev                # http://localhost:3000
```

Or via Docker:

```bash
make build && make run     # http://localhost:8080
```

### Required env

| Var | Where to get it |
|---|---|
| `BIRDEYE_API_KEY` | https://bds.birdeye.so/ — token prices, balances, historical pricing |
| `HELIUS_API_KEY` | https://helius.dev/ — Enhanced Transactions API for swap parsing |
| `LAMBDA_P2P_API_KEY` | DeFi positions provider |
| `DIALECT_API_KEY` | https://dial.to — DeFi positions data (Markets API, not notifications) |
| `METRICS_SECRET` | any 32-byte random string; gates `/api/metrics` |

The server **throws on startup** if any of these are missing — there are no default fallbacks.

### Optional env

- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — pings your Telegram on signup + usage (see below)
- `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile bot protection
- `PORT` (default 3000 locally, 8080 in Docker)

## Deploy

The repo ships a `Dockerfile` and is deployable anywhere that runs containers — Fly.io, Render, Cloud Run, Railway, a VPS with Docker, your laptop. The image is ~150 MB on `node:22-alpine`.

```bash
docker build -t portfolio .
docker run --rm -p 8080:8080 --env-file .env portfolio
```

Hosted public instance: <https://portfolio.niks3089.com>. Deployment automation for that instance lives in a separate private repo.

## Telegram notifications

If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, the server pings the chat on:

- **signup** — first time a wallet connects (one per wallet, forever)
- **usage** — periodic active-user heartbeat (one per wallet per ~hour)

The wallet pubkey is in the message body. To anonymize, replace the body of `/api/internal/ping` in `server/routes/internal.js` with a hash.

## Privacy notes for self-hosters

- The server sees wallet addresses (when fetching balances), IPs (in logs + rate limiting), and whatever you send to the Telegram ping endpoint
- The server does **not** see your portfolio groupings, search history, or tracker snapshots — those are in your browser
- All upstream API keys live server-side; the browser never sees them
- Clearing your browser data wipes your portfolios. There's no backup. (Cross-device sync without server visibility is a known follow-up — see comments in `index.html` around `labelsStorageKey`.)

## License

MIT
