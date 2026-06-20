# Deploying to a VM

The encrypted vault lives in a single SQLite file on disk. There is no
managed database to provision. The deploy is just: build, rsync, restart.

## First time

On the VM (Debian/Ubuntu, Node 22+ installed):

```bash
sudo ./deploy/install.sh
```

That creates the `portfolio` system user, the vault directory at
`/var/lib/portfolio` (mode 0700), and the systemd unit.

Write `/etc/portfolio/portfolio.env` from `.env.example`. Set:

```
PORT=8080
VAULT_DB_PATH=/var/lib/portfolio/vault.db
```

Drop the nginx site (`deploy/nginx.conf`) into `/etc/nginx/sites-available/portfolio`,
replace `<host>` with your domain, symlink into `sites-enabled`, then:

```bash
sudo certbot --nginx -d portfolio.example.com
sudo systemctl start portfolio
```

## Subsequent deploys

Build locally or in CI:

```bash
npm ci
npm run build
cd client && npm ci && npm run build && cd ..
```

Rsync the artifacts to `/opt/portfolio` (owned by `portfolio:portfolio`):

```
dist/          # compiled server
public/        # static assets + Vite-built client
node_modules/  # production deps only — re-install with --omit=dev on the VM
package.json
package-lock.json
```

Then `sudo systemctl restart portfolio`.

## Backups

The only state worth backing up is `/var/lib/portfolio/vault.db`. Because
every row is AES-GCM ciphertext keyed by the user's wallet signature, the
backup is opaque too — you can copy it anywhere without leaking user data.
Lose the user's wallet, lose access to their vault row; the operator
cannot recover it.

```bash
sudo sqlite3 /var/lib/portfolio/vault.db ".backup '/tmp/vault.bak'"
```
