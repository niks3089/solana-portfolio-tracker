.PHONY: dev start install db-init deploy deploy-dry-run logs ssh status restart vault-encrypt vault-edit vault-view setup

# Local development
dev:
	npm run dev

start:
	npm start

install:
	npm install

db-init:
	npm run db:init

# Setup (first time)
setup:
	cd deployment && ansible-galaxy collection install -r requirements.yml

# Deployment
deploy:
	cd deployment && ansible-playbook deploy.yml --vault-password-file ~/.vault_password

deploy-dry-run:
	cd deployment && ansible-playbook deploy.yml --vault-password-file ~/.vault_password --check

# Server management
ssh:
	ssh root@207.148.27.173

logs:
	ssh root@207.148.27.173 "journalctl -u portfolio -f"

status:
	ssh root@207.148.27.173 "systemctl status portfolio"

restart:
	ssh root@207.148.27.173 "systemctl restart portfolio"

# Vault management
vault-encrypt:
	cd deployment && ansible-vault encrypt vars/vault.yml

vault-edit:
	cd deployment && ansible-vault edit vars/vault.yml

vault-view:
	cd deployment && ansible-vault view vars/vault.yml

