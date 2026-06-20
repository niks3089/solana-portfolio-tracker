#!/usr/bin/env bash
# One-shot installer for a fresh Debian/Ubuntu VM. Idempotent — safe to re-run.
#
# What it does:
#   1. Creates a system user `portfolio` (no shell, no login).
#   2. Creates /opt/portfolio   (code, owned by portfolio:portfolio, 0755)
#              /var/lib/portfolio (SQLite vault, 0700 — only the portfolio
#              user and root can read the encrypted blobs)
#              /etc/portfolio   (env file, 0750)
#   3. Drops the systemd unit and enables it.
#
# After running, you still need to:
#   - rsync the built app to /opt/portfolio  (dist/, public/, node_modules/, package.json)
#   - write /etc/portfolio/portfolio.env     (mode 0640, root:portfolio)
#   - install + symlink deploy/nginx.conf, run certbot
#   - systemctl start portfolio
set -euo pipefail

APP_USER=portfolio
APP_HOME=/opt/portfolio
VAULT_DIR=/var/lib/portfolio
ENV_DIR=/etc/portfolio
UNIT=/etc/systemd/system/portfolio.service

if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
fi

install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_HOME"
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$VAULT_DIR"
install -d -o root        -g "$APP_USER" -m 0750 "$ENV_DIR"

# 0700 on the vault dir means even other unprivileged users on this host
# can't list/stat the database file. Root can — and per the threat model
# in the README, that's the operator boundary we're explicit about.

install -m 0644 "$(dirname "$0")/portfolio.service" "$UNIT"
systemctl daemon-reload
systemctl enable portfolio.service

echo "Installed. Next:"
echo "  - rsync app to $APP_HOME"
echo "  - write $ENV_DIR/portfolio.env (chmod 0640, chown root:$APP_USER)"
echo "  - install nginx site, run certbot"
echo "  - systemctl start portfolio"
