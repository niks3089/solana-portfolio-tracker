.PHONY: dev start install build help

dev:
	npm run dev

start:
	npm start

install:
	npm install
	cd client && npm install

build:
	npm run build
	cd client && npm run build

help:
	@echo "Local:"
	@echo "  make install      Install server + client deps"
	@echo "  make dev          Run dev server (npm run dev)"
	@echo "  make build        Build server + client"
	@echo "  make start        Run built server (dist/index.js)"
	@echo ""
	@echo "Deploy: see deploy/README.md"
