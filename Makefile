.PHONY: dev start install db-init deploy deploy-staging deploy-all init init-staging sanity-test logs ssh status restart vault-encrypt vault-edit vault-view setup help

# ============================================================================
# Local development
# ============================================================================
dev:
	npm run dev

start:
	npm start

install:
	npm install

db-init:
	npm run db:init

# ============================================================================
# Setup (first time on local machine)
# ============================================================================
setup:
	cd deployment && ansible-galaxy collection install -r requirements.yml

# ============================================================================
# STAGING - Deploy here first!
# ============================================================================
deploy-staging:
	@echo "🚀 Deploying to STAGING (45.76.155.10)..."
	cd deployment && ansible-playbook -i inventory/staging.yml deploy.yml -e @vars/staging.yml

init-staging:
	@echo "🔧 Initializing STAGING server..."
	cd deployment && ansible-playbook -i inventory/staging.yml init.yml -e @vars/staging.yml

test-staging:
	@echo "🧪 Running sanity tests on STAGING..."
	./scripts/sanity-test.sh http://45.76.155.10:3000

ssh-staging:
	ssh ubuntu@45.76.155.10

logs-staging:
	ssh ubuntu@45.76.155.10 "sudo journalctl -u portfolio -f"

status-staging:
	ssh ubuntu@45.76.155.10 "sudo systemctl status portfolio"

# ============================================================================
# PRODUCTION - Only after staging passes!
# ============================================================================
deploy:
	@echo "⚠️  Deploying to PRODUCTION (portfolio.niks3089.com)..."
	@echo "    Make sure staging tests passed first!"
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	cd deployment && ansible-playbook -i inventory/prod.yml deploy.yml -e @vars/prod.yml

deploy-force:
	@echo "🚨 FORCE deploying to PRODUCTION (skipping confirmation)..."
	cd deployment && ansible-playbook -i inventory/prod.yml deploy.yml -e @vars/prod.yml

init:
	@echo "🔧 Full initialization on PRODUCTION..."
	cd deployment && ansible-playbook -i inventory/prod.yml init.yml -e @vars/prod.yml

test-prod:
	@echo "🧪 Running sanity tests on PRODUCTION..."
	./scripts/sanity-test.sh https://portfolio.niks3089.com

# ============================================================================
# SAFE DEPLOY - Staging → Tests → Prod (recommended!)
# ============================================================================
deploy-all:
	@echo "🔄 Safe deploy: Staging → Tests → Production"
	@echo ""
	@echo "Step 1/4: Deploying to staging..."
	$(MAKE) deploy-staging
	@echo ""
	@echo "Step 2/4: Running sanity tests on staging..."
	$(MAKE) test-staging
	@echo ""
	@echo "Step 3/4: Deploying to production..."
	$(MAKE) deploy-force
	@echo ""
	@echo "Step 4/4: Running sanity tests on production..."
	$(MAKE) test-prod
	@echo ""
	@echo "✅ Deploy complete!"

# ============================================================================
# Production server management
# ============================================================================
ssh:
	ssh ubuntu@207.148.27.173

logs:
	ssh ubuntu@207.148.27.173 "sudo journalctl -u portfolio -f"

status:
	ssh ubuntu@207.148.27.173 "sudo systemctl status portfolio"

restart:
	ssh ubuntu@207.148.27.173 "sudo systemctl restart portfolio"

nginx-logs:
	ssh ubuntu@207.148.27.173 "sudo tail -f /var/log/nginx/access.log"

nginx-errors:
	ssh ubuntu@207.148.27.173 "sudo tail -f /var/log/nginx/error.log"

# ============================================================================
# Metrics
# ============================================================================
metrics-staging:
	@curl -s "http://45.76.155.10:3000/api/metrics?secret=staging_m3tr1cs_s3cr3t" | jq .

metrics-prod:
	@curl -s "https://portfolio.niks3089.com/api/metrics?secret=saul_m3tr1cs_s3cr3t_2024" | jq .

# ============================================================================
# Vault management
# ============================================================================
vault-encrypt:
	cd deployment && ansible-vault encrypt vars/vault.yml

vault-edit:
	cd deployment && ansible-vault edit vars/vault.yml

vault-view:
	cd deployment && ansible-vault view vars/vault.yml

# ============================================================================
# Help
# ============================================================================
help:
	@echo "Portfolio Dashboard - Deployment Commands"
	@echo ""
	@echo "🔒 SAFE DEPLOY (recommended):"
	@echo "  make deploy-all      - Deploy staging → test → prod"
	@echo ""
	@echo "📦 STAGING:"
	@echo "  make init-staging    - First-time setup for staging server"
	@echo "  make deploy-staging  - Deploy code to staging"
	@echo "  make test-staging    - Run sanity tests on staging"
	@echo "  make ssh-staging     - SSH into staging server"
	@echo "  make logs-staging    - View staging logs"
	@echo "  make metrics-staging - View staging metrics"
	@echo ""
	@echo "🚀 PRODUCTION:"
	@echo "  make init            - First-time setup for prod server"
	@echo "  make deploy          - Deploy to prod (with confirmation)"
	@echo "  make deploy-force    - Deploy to prod (no confirmation)"
	@echo "  make test-prod       - Run sanity tests on production"
	@echo "  make ssh             - SSH into prod server"
	@echo "  make logs            - View prod logs"
	@echo "  make metrics-prod    - View prod metrics"
	@echo ""
	@echo "🛠️  LOCAL:"
	@echo "  make dev             - Run local dev server"
	@echo "  make install         - Install dependencies"
