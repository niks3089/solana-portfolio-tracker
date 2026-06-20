.PHONY: dev start install build run logs help

dev:
	npm run dev

start:
	npm start

install:
	npm install

build:
	docker build -t portfolio:local .

run:
	docker run --rm -p 8080:8080 --env-file .env portfolio:local

logs:
	@test -n "$$GCP_PROJECT_ID" -a -n "$$CLOUD_RUN_SERVICE" -a -n "$$GCP_REGION" \
	  || { echo "set GCP_PROJECT_ID, CLOUD_RUN_SERVICE, GCP_REGION"; exit 1; }
	gcloud run services logs tail "$$CLOUD_RUN_SERVICE" \
	  --project="$$GCP_PROJECT_ID" --region="$$GCP_REGION"

help:
	@echo "Local:"
	@echo "  make dev          Run dev server (npm run dev)"
	@echo "  make build        Build Docker image"
	@echo "  make run          Run Docker image with .env"
	@echo ""
	@echo "Deploy:"
	@echo "  push to main      → GitHub Actions builds + deploys to Cloud Run"
	@echo "  make logs         Tail Cloud Run logs (set GCP_PROJECT_ID etc.)"
