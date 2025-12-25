.PHONY: dev start install db-init deploy init deploy-dry-run init-dry-run logs ssh status restart vault-encrypt vault-edit vault-view setup

# Local development
dev:
	npm run dev

start:
	npm start

install:
	npm install

db-init:
	npm run db:init

# Setup (first time on local machine)
setup:
	cd deployment && ansible-galaxy collection install -r requirements.yml

# Deployment (code only - fast)
deploy:
	cd deployment && ansible-playbook deploy.yml

deploy-dry-run:
	cd deployment && ansible-playbook deploy.yml --check

# Full initialization (PostgreSQL, Nginx, SSL, etc.)
init:
	cd deployment && ansible-playbook init.yml

init-dry-run:
	cd deployment && ansible-playbook init.yml --check

# Server management
ssh:
	ssh root@207.148.27.173

logs:
	ssh root@207.148.27.173 "journalctl -u portfolio -f"

status:
	ssh root@207.148.27.173 "systemctl status portfolio"

restart:
	ssh root@207.148.27.173 "systemctl restart portfolio"

nginx-logs:
	ssh root@207.148.27.173 "tail -f /var/log/nginx/access.log"

nginx-errors:
	ssh root@207.148.27.173 "tail -f /var/log/nginx/error.log"

# Vault management
vault-encrypt:
	cd deployment && ansible-vault encrypt vars/vault.yml

vault-edit:
	cd deployment && ansible-vault edit vars/vault.yml

vault-view:
	cd deployment && ansible-vault view vars/vault.yml
