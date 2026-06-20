## Portfolio Dashboard

Self-hosted multi-wallet Solana portfolio tracker. Token holdings, DeFi positions across major protocols, trade-based P&L (cost basis from on-chain swap history + transfer-in pricing), Returns summary with XIRR, and a Trade History panel linking out to a block explorer.

Portfolios, snapshots, and connected-wallet state live in **`localStorage`** — the server never persists user data. There is no database, no auth, no paid tier.

### Stack

- Node.js + Express backend (thin proxy: hides Helius/Birdeye API keys, computes derived data like XIRR)
- Vanilla JS / HTML / CSS frontend (single `public/index.html`)
- Optional Telegram webhook for signup/usage pings
- Containerized: deploys to Google Cloud Run

### Quick start (local)

```bash
cp .env.example .env       # fill in API keys
npm install
npm run dev                # http://localhost:3000
```

Or via Docker:

```bash
make build && make run     # http://localhost:8080
```

Required env: `BIRDEYE_API_KEY`, `HELIUS_API_KEY`, `LAMBDA_P2P_API_KEY`, `DIALECT_API_KEY` (DeFi positions data, not notifications), `METRICS_SECRET`.

Optional: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for signup/active-user pings; `TURNSTILE_*` for Cloudflare bot protection.

### Deploy to Cloud Run

The repo ships with a single GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds a Docker image, pushes it to Artifact Registry, and `gcloud run deploy`s it. Push to `main` and it runs.

One-time setup:

1. **GCP project**: enable Cloud Run, Artifact Registry, and (if you want OIDC instead of a long-lived key) Workload Identity Federation.
2. **Artifact Registry repo**: `gcloud artifacts repositories create portfolio --repository-format=docker --location=us-central1`
3. **Service account** for GitHub Actions with roles: `roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`. Bind it to your GitHub repo via Workload Identity Federation (recommended) or download a JSON key.
4. **GitHub repo settings**:
   - **Variables** (Settings → Secrets and variables → Actions → Variables):
     - `GCP_PROJECT_ID`, `GCP_REGION` (e.g. `us-central1`), `CLOUD_RUN_SERVICE` (e.g. `portfolio`), `ARTIFACT_REGISTRY_REPO` (matches step 2), `PROD_URL` (your eventual public URL, optional)
   - **Secrets**:
     - `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SA`
     - `BIRDEYE_API_KEY`, `HELIUS_API_KEY`, `LAMBDA_P2P_API_KEY`, `DIALECT_API_KEY`, `METRICS_SECRET`
     - Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`

Custom domain: `gcloud run domain-mappings create --service=portfolio --domain=portfolio.example.com --region=$REGION` (then point your DNS at the returned record).

### Telegram notifications

If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, the server pings the chat on:

- **signup** — first time a wallet connects (deduplicated per wallet, forever)
- **usage** — periodic active-user heartbeat (one per wallet per ~6 hours)

The wallet pubkey is included. To anonymize, replace the body of `/api/internal/ping` in `server/routes/internal.js` with a hash.

### License

MIT
