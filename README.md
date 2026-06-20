# Portfolio Dashboard

Self-hosted multi-wallet Solana portfolio tracker.

- **Token holdings** with prices, balances, USD values
- **DeFi positions** across major protocols (Kamino, Drift, Exponent, …)
- **Trade-based P&L** — cost basis derived from on-chain swap history, with transfer-in pricing from historical Birdeye data when the token entered the wallet via transfer
- **Returns summary** — Current Value, Invested, Absolute Return, XIRR (annualized)
- **Trade History panel** — every priced buy/sell with links out to a block explorer
- **Portfolios** — group multiple wallets and track them together (a "household"); cost basis follows tokens across your wallets
- **Per-portfolio tracker chart** — net-worth snapshots accumulate as you open the dashboard

## State storage

Portfolios, snapshots, and the tracked-wallet list are stored on the server in an **end-to-end encrypted vault** keyed by your wallet signature. The server never sees the plaintext — see [Encryption design](#encryption-design) below. Server source code that touches the vault is exactly two files: [`server/vault.ts`](./server/vault.ts) (~40 lines, SQLite store) and [`server/routes/vault.ts`](./server/routes/vault.ts) (~50 lines, GET/PUT). Neither imports a crypto library.

UI-only state (which portfolio is currently selected) lives in `localStorage`.

## Stack

- Node.js + Express backend, TypeScript
- React 19 + Vite + Tailwind v4 frontend
- SQLite (better-sqlite3) for the opaque vault
- AES-256-GCM via the browser's Web Crypto API for client-side encryption
- Jupiter Unified Wallet Kit for wallet connection
- Optional Telegram webhook for signup/usage pings

## Quick start

```bash
cp .env.example .env       # fill in the four required API keys
make install               # server + client deps
npm run dev                # http://localhost:3000
```

In another terminal:

```bash
cd client && npm run dev   # Vite dev server on :5173, proxies /api to :3000
```

### Required env

| Var | Where to get it |
|---|---|
| `BIRDEYE_API_KEY` | https://bds.birdeye.so/ — token prices, balances, historical pricing |
| `HELIUS_API_KEY` | https://helius.dev/ — Enhanced Transactions API for swap parsing |
| `LAMBDA_P2P_API_KEY` | DeFi positions provider |
| `DIALECT_API_KEY` | https://dial.to — DeFi positions data (Markets API, not notifications) |
| `METRICS_SECRET` | any 32-byte random string; gates `/api/metrics` |
| `VAULT_DB_PATH` | filesystem path for the SQLite vault (default `./data/vault.db`) |

The server **throws on startup** if any of the API keys are missing — there are no default fallbacks.

### Optional env

- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — pings your Telegram on signup + usage
- `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile bot protection
- `PORT` (default 3000)

## Deploy

VM-first. There is no managed database, no container orchestrator. Just `node dist/index.js` behind nginx + certbot, with the vault SQLite file bind-mounted to disk.

See [`deploy/README.md`](./deploy/README.md) for the full walkthrough. The repo ships:

- `deploy/install.sh` — creates the `portfolio` system user, vault directory (`/var/lib/portfolio`, mode 0700), and systemd unit
- `deploy/portfolio.service` — hardened systemd unit (sandboxed via `ProtectSystem=strict`, `ReadWritePaths=/var/lib/portfolio`)
- `deploy/nginx.conf` — reverse-proxy template with WebSocket upgrade for `/api/stream`

Backing up the whole instance = `sqlite3 backup` on `/var/lib/portfolio/vault.db`. Because every row is AES-GCM ciphertext, the backup file is opaque too.

Hosted public instance: <https://portfolio.niks3089.com>. Deployment automation for that instance lives in a separate private repo and uses the same scaffolding under `deploy/`.

## Encryption design

The operator (me, you, anyone with SSH on the VM) cannot read user portfolios. This is enforced by code, not policy.

### What the server sees

`vault` table, one row per connecting wallet:

| column | content |
|---|---|
| `owner_wallet` | the user's Solana pubkey (base58) — needed as the DB lookup key |
| `ciphertext` | opaque AES-GCM bytes |
| `iv` | 12-byte AES-GCM nonce |
| `version` | optimistic concurrency counter |
| `updated_at` | epoch millis |

Nothing else. No portfolio names, no wallet groupings, no snapshots, no per-wallet labels — those all live inside `ciphertext`. You can audit this in [`server/vault.ts`](./server/vault.ts) and [`server/routes/vault.ts`](./server/routes/vault.ts): there is no decryption code on the server, anywhere. Search the server tree for `crypto.subtle`, `aes`, `decipher`, `decrypt` — you'll find zero matches.

### Where the key comes from

The encryption key is derived in the browser from the user's wallet signature:

1. The client asks the wallet (Phantom / Solflare / Backpack / …) to sign the deterministic challenge
   ```
   solana-portfolio:vault:v1:<the user's pubkey>
   ```
   ed25519 signatures over a fixed message are deterministic (RFC 8032), so the *same wallet over the same message* always produces the *same signature*. That gives us a stable key without storing any seed.
2. `key = SHA-256(signature)` — 32 bytes, used as an AES-256-GCM key.
3. The key is cached in `sessionStorage` so reloading the tab doesn't re-prompt. It's evicted on tab close.

The key never leaves the browser. The server never sees the signature, never sees the SHA-256 output, never sees plaintext.

### What the client does

Encrypt on save, decrypt on load. See [`client/src/lib/vault.ts`](./client/src/lib/vault.ts) and [`client/src/hooks/useVault.ts`](./client/src/hooks/useVault.ts). Single AES-GCM blob per user; a fresh 96-bit IV per write.

### Threat model

| Adversary | Can they read your portfolios? |
|---|---|
| Operator with full SSH on the VM | No. They see ciphertext + your pubkey. |
| Operator who dumps the SQLite file | No. Same — opaque blob. |
| Operator who tampers with future server builds to log ciphertext | Yes, of the bytes — but the bytes are still AES-GCM. To recover plaintext they'd also need your wallet signature (which they cannot forge without your private key). |
| Operator who serves modified JavaScript to your browser | **Yes.** They could ship JS that exfiltrates the key after you sign. This is the unavoidable trust boundary for any web app — your defence is to use the public hosted instance and check the [Sources tab in DevTools](https://developer.chrome.com/docs/devtools/sources/), or to self-host. |
| Anyone with your wallet's private key | Yes. The signature is recomputable. (They also already own your funds.) |
| Network observer | No. TLS to the server; payload is ciphertext anyway. |
| Other tabs / extensions in your browser | The key is in `sessionStorage`, accessible only to same-origin scripts. Extensions with `<all_urls>` permissions can read it. |

What is **not** encrypted, by necessity:
- Your pubkey. It's the lookup key for the vault row.
- The wallets you actively query (those go through Helius/Birdeye via the server's API key; server logs see the addresses requested).

### Audit it yourself

```bash
# Confirm no vault decryption on the server.
# The only matches you should see are README-style doc comments and
# server/utils/jwt.ts (HMAC for the signup-throttling cookie — unrelated
# to the vault):
grep -rEn 'crypto\.subtle|createDecipher|decrypt' server/

# Confirm what the server stores — owner_wallet + ciphertext + iv + version:
grep -A 10 'CREATE TABLE' server/vault.ts

# Confirm the client key derivation is what the README claims:
cat client/src/lib/vault.ts
```

## Telegram notifications

If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, the server pings the chat on:

- **signup** — first time a wallet connects (one per wallet, forever)
- **usage** — periodic active-user heartbeat (one per wallet per ~hour)

The wallet pubkey is in the message body. To anonymize, replace the body of `/api/internal/ping` in `server/routes/internal.ts` with a hash.

## License

MIT
