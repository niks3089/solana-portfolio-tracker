# CLAUDE.md

Context for coding agents working in this repo.

## What this is

Self-hosted, multi-wallet Solana portfolio tracker. React 19 + Vite + Tailwind v4 SPA in `client/`; Node 22 + Express + TypeScript server in `server/`. State lives on the server as an AES-GCM ciphertext blob per wallet in `better-sqlite3`; the server never decrypts. See `README.md` for the threat model.

## Layout

```
server/           TypeScript backend (tsc → dist/)
  index.ts        Express app; mounts /api/portfolio, /api/vault, /api/internal
  vault.ts        SQLite opaque-blob store — no crypto imports, auditable
  routes/         Route handlers
  utils/          Cross-cutting (Helius, Birdeye, SNS resolver, etc.)
client/           Vite + React + Tailwind SPA (served at /app/*)
  src/pages/Dashboard.tsx       Main view
  src/hooks/useVault.ts         Lazy vault (unlock() prompts signature)
  src/hooks/usePortfolios.ts    Vault-backed portfolio CRUD + migration
  src/hooks/useTrackedWallets.ts localStorage wallet list (no auth)
  src/lib/vault.ts              AES-GCM + sig-derived key
deploy/           systemd unit, nginx template, install.sh, deploy README
.github/workflows/deploy.yml    On push to main → repository_dispatch to ops repo
```

## Cardinal rules

- **The server MUST NEVER decrypt or otherwise inspect vault payloads.** `server/vault.ts` + `server/routes/vault.ts` are the entire surface. Do not import `crypto.subtle`, `createDecipher`, or any decryption there. The README claims this is audit-verifiable with a grep; keep it true.
- **API keys are server-only.** Nothing under `client/` should ever read `BIRDEYE_API_KEY` / `HELIUS_API_KEY` / `LAMBDA_P2P_API_KEY` / `DIALECT_API_KEY`. If the client needs data, add a server route that proxies.
- **The vault session key is per-wallet.** `sessionStorage` key is `vault.aesKey:<pubkey>`. Never regress to a single shared key — that's a data-leak bug we've already fixed.
- **Tracked wallets are per-browser localStorage, NOT vault data.** They're ephemeral browsing state. Don't move them into `VaultPayload`.
- **Vault writes are authenticated with a separate signature.** Two distinct wallet messages: key derivation (`vault:v1:<pubkey>`, never sent) and auth challenge (`vault-auth:v1:<pubkey>:<ts>`, sent to `POST /api/vault/:wallet/session` → JWT). Never collapse them into one signature — that would leak the AES key to the server. `PUT /api/vault/:wallet` requires `Authorization: Bearer <token>` bound to the wallet.
- **`JWT_SECRET` is required.** Server refuses to start without a 32+ byte secret. It signs vault-session JWTs and the Turnstile cookie.

## Dev

```bash
make install                # server + client deps
cp .env.example .env        # fill required API keys
npm run dev                 # server on :3000
cd client && npm run dev    # Vite on :5173, proxies /api → :3000
```

`npm run typecheck` and `cd client && npm run typecheck` both must be clean before commit. Client build: `cd client && npm run build`.

## Deploy

There is no `Dockerfile` or Cloud Run in this repo any more — deploys go to a VM. See `deploy/README.md`. A private ops repo (`niks3089/portfolio-ops`) holds the GitHub Actions workflow that rsyncs `dist/` + `public/` + prod `node_modules/` to `/opt/portfolio` on the VM and runs `sudo systemctl restart portfolio.service`. `.github/workflows/deploy.yml` in this repo only fires a `repository_dispatch` at the ops repo.

## Data model

Server vault row (SQLite table `vaults`):

```
owner_wallet TEXT PRIMARY KEY   -- the user's Solana pubkey, base58
ciphertext   BLOB               -- AES-256-GCM(JSON.stringify(VaultPayload))
iv           BLOB               -- 12 bytes, fresh per write
version      INTEGER            -- optimistic concurrency counter
updated_at   INTEGER            -- epoch millis
```

Client `VaultPayload` (`client/src/lib/portfolios.ts`):

```
{ portfolios: Portfolio[], snapshots: Record<portfolioId, Record<YYYY-MM-DD, netWorth>> }
```

Legacy migration: on first vault load (version 0, empty payload), `usePortfolios` reads pre-vault `labels:<wallet>` + `snapshots:<wallet>:<id>` from localStorage and seeds the vault. Legacy keys are never deleted (local backup).

## Conventions

- TypeScript strict mode + `noUncheckedIndexedAccess`. Prefer `array[i]!` only where you've just bounds-checked.
- No new deps without a clear justification. `stdlib > native > existing dep > new dep`.
- Comments explain *why*, not *what*. If it's a deliberate shortcut, mark it `// ponytail: <what and when to upgrade>`.
- Server: ES modules, `.js` extensions in imports (tsc doesn't rewrite them).
- Client: Tailwind v4, uses the design tokens in `client/src/styles.css` (`bg-bg-primary`, `text-text-secondary`, `border-border`, `text-accent`, `text-negative`).

## What NOT to do

- Don't add a JS framework layer (no Next.js, no state-management lib). Vite + Query + local state is the ceiling.
- Don't reintroduce Postgres, Docker, or Cloud Run. That's decommissioned infrastructure.
- Don't add wallet-adapter-*-specific code — Jupiter Unified Wallet Kit (`@jup-ag/wallet-adapter`) covers Phantom / Solflare / Backpack / Coinbase / etc. through one provider.
- Don't gate the whole dashboard on wallet connection. Anyone should be able to paste a wallet and browse. Vault (portfolio saving) is the only feature behind a signature.
