# Portfolio Dashboard

A minimalistic multi-wallet portfolio tracker for Solana.

## Features

- Track multiple Solana wallets
- Real-time portfolio value updates
- Token holdings with USD values
- Transaction history

## Local Development

```bash
npm install
npm run dev
```

## Deployment

### First Time Setup

```bash
# Install Ansible collections
make setup

# Encrypt the vault (set a password)
make vault-encrypt
```

### Deploy

```bash
# Deploy to production
make deploy

# Dry run
make deploy-dry-run
```

### Server Management

```bash
make ssh        # SSH to server
make logs       # View logs
make status     # Check service status
make restart    # Restart service
```

### GitHub Actions

Push to `main` branch triggers automatic deployment.

**Required Secrets:**
- `DEPLOY_KEY` - SSH private key for server access
- `VAULT_PASSWORD` - Ansible vault password

## Project Structure

```
portfolio/
├── public/              # Frontend
├── scripts/             # DB scripts
├── server.js            # Express server
├── package.json
├── Makefile             # Shortcuts
└── deployment/          # Ansible deployment
    ├── ansible.cfg
    ├── deploy.yml       # Main playbook
    ├── requirements.yml # Ansible collections
    ├── inventory/
    │   └── prod.yml     # Server inventory
    ├── vars/
    │   ├── prod.yml     # Environment vars
    │   └── vault.yml    # Encrypted secrets
    └── ansible/roles/portfolio/
        ├── tasks/main.yml
        ├── templates/
        └── handlers/
```

## Infrastructure

- **Server**: 207.148.27.173 (Vultr)
- **Database**: PostgreSQL 17
- **Process Manager**: systemd
- **Service Name**: `portfolio`
