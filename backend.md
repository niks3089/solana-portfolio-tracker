# Backend Services

| Service | Purpose | Data |
|---------|---------|------|
| **Dialect API** | User authentication | Wallet signature → JWT token |
| **Dialect API** | Subscribe to notifications | Register wallet for Telegram alerts |
| **Dialect SDK** | Send notifications | Push tx alerts to user's Telegram |
| **PostgreSQL** | Store settings | Alerts, portfolios, telegram usernames |
| **Birdeye API** | Token prices & P&L | Holdings, prices, profit/loss data |
| **Helius RPC** | Wallet data | Token balances, transaction history |
