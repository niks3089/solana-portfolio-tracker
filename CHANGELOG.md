# Changelog

Managed by [release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/). Merging the release PR that release-please opens on `main` tags a new version and appends a section here.

## [1.2.0](https://github.com/niks3089/solana-portfolio-tracker/compare/solana-portfolio-tracker-v1.1.0...solana-portfolio-tracker-v1.2.0) (2026-09-03)


### Features

* cost basis for fully-deposited tokens via mint metadata lookup ([b3c8de5](https://github.com/niks3089/solana-portfolio-tracker/commit/b3c8de54f51b93db28af87c2fac0a4b76573abba))
* display-currency dropdown (USD/EUR/GBP/JPY/INR) with daily FX rates ([8459ae6](https://github.com/niks3089/solana-portfolio-tracker/commit/8459ae6482489448143e611f4e8484aa8ce8551f))
* orbmarkets links for wallets and token mints in tables ([4f20904](https://github.com/niks3089/solana-portfolio-tracker/commit/4f20904e52f413d75d0ac1c7c94f2a1488d76b1b))
* wallet-split donut for multi-wallet portfolios ([b06d7cd](https://github.com/niks3089/solana-portfolio-tracker/commit/b06d7cdd4c50d66950e8a626ff1b3350c04ed6e2))


### Bug Fixes

* currency toggle no longer remounts dashboard (kept vault unlocked) ([085f47a](https://github.com/niks3089/solana-portfolio-tracker/commit/085f47aecb3d9b1b695fe20081d3109afd512e79))
* dedupe DeFi positions held as wallet SPL tokens (Exponent PT double count) ([af73c08](https://github.com/niks3089/solana-portfolio-tracker/commit/af73c08258b7dc3c3a684f5f5699903c108b15c2))
* default per-wallet holdings view; fold DeFi deposits into grouped tokens; donut names + percentages ([8cec554](https://github.com/niks3089/solana-portfolio-tracker/commit/8cec554e4530a850edfe09d6e47f721d53afe03e))
* drop spam tokens spoofing stable/SOL symbols; drop stale Dialect Kamino rows absent from Lambda ([e8f9025](https://github.com/niks3089/solana-portfolio-tracker/commit/e8f9025516bf3fdb8ea8e2468bce6fa5255ae296))
* restrict wallet-token dedupe to Exponent/PT positions ([a39d9b6](https://github.com/niks3089/solana-portfolio-tracker/commit/a39d9b64299bfaec4e8efc7dbd3bb53e5b7778af))
* verify Birdeye prices &gt;=$25 against Jupiter to drop dead-pool phantom values ([#9](https://github.com/niks3089/solana-portfolio-tracker/issues/9)) ([e9222dd](https://github.com/niks3089/solana-portfolio-tracker/commit/e9222dda1ab2b85be1f2bf34b36f6613e58f3141))

## [1.1.0](https://github.com/niks3089/solana-portfolio-tracker/compare/solana-portfolio-tracker-v1.0.0...solana-portfolio-tracker-v1.1.0) (2026-08-20)


### Features

* aggregate token view + allocation donut; single-signature unlock; fix XIRR terminal value ([85b0197](https://github.com/niks3089/solana-portfolio-tracker/commit/85b01977afb29cd47537a26fd49eaa1592ff8530))


### Bug Fixes

* raise trade-history scan to 2000 txs per wallet for XIRR cashflows ([913a42e](https://github.com/niks3089/solana-portfolio-tracker/commit/913a42e580fdb9b34097eea91e5a8dfe4a62e2ff))

## [1.0.0](https://github.com/niks3089/solana-portfolio-tracker/compare/solana-portfolio-tracker-v0.1.0...solana-portfolio-tracker-v1.0.0) (2026-07-08)


### ⚠ BREAKING CHANGES

* `PUT /api/vault/:wallet` now requires a Bearer token from `POST /api/vault/:wallet/session`. Clients built before this commit will get 401 on save. JWT_SECRET env var is now required.

### Features

* authenticate vault writes + close 7 review gaps ([7a74b43](https://github.com/niks3089/solana-portfolio-tracker/commit/7a74b43b34614b38425665ac63ac8deaefe3f11c))

## 0.1.0 - 2026-07-08

Initial public release.

### Highlights

- **Encrypted server vault**: portfolios + snapshots persisted server-side as opaque AES-256-GCM ciphertext. Key is derived in the browser from a deterministic wallet signature (`SHA-256(sign("solana-portfolio:vault:v1:<pubkey>"))`), cached per-wallet in `sessionStorage`. Server-side surface is `server/vault.ts` + `server/routes/vault.ts` — auditable to contain zero decryption code.
- **Legacy migration**: pre-vault portfolios stored under `labels:<wallet>` in browser localStorage are automatically read, encrypted, and seeded into the vault on first unlock. Legacy entries are preserved as a local backup.
- **Multi-wallet dashboard**: paste any wallet or `.sol` name to view holdings, DeFi positions across Kamino / Drift / Meteora / Exponent, all-time P&L with XIRR, and a trade history table.
- **No connect-required gate**: browsing any wallet works without connecting or signing. Connect only to save named portfolios across devices.
- **VM-first deploy**: `deploy/install.sh` + hardened systemd unit + nginx template. SQLite vault at `/var/lib/portfolio/vault.db` (mode 0700).
- **CI**: typecheck + build for server and client on every PR.
