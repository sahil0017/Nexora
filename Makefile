.PHONY: help up down logs build api-test ml-test fmt

help:
	@echo "nexora dev commands:"
	@echo "  make up       - start docker compose stack"
	@echo "  make down     - stop stack"
	@echo "  make logs     - follow api logs"
	@echo "  make api-test - run go tests"
	@echo "  make ml-test  - run python tests"

up:
	docker compose up --build -d

down:
	docker compose down

down-v:
	docker compose down -v

logs:
	docker compose logs -f api

ps:
	docker compose ps

api-test:
	cd backend/api && go test ./...

ml-test:
	cd intelligence/ml-platform && python -m pytest

fmt:
	cd backend/api && go fmt ./...
