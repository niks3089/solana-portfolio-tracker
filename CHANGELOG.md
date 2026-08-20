# Changelog

Managed by [release-please](https://github.com/googleapis/release-please) from
[Conventional Commits](https://www.conventionalcommits.org/). Merging the release PR that release-please opens on `main` tags a new version and appends a section here.

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
