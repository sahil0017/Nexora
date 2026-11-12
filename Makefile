.PHONY: help up down logs build api-test ml-test mobile-test ci lint fmt git-hooks aws-deploy aws-smart aws-status aws-stop aws-start aws-session aws-logs aws-restart aws-destroy

# AWS free-tier deployment (requires .env.aws — see infra/aws/env.aws.example)
aws-deploy:
	./scripts/deploy-aws.sh deploy
aws-smart:
	./scripts/deploy-aws.sh smart
aws-status:
	./scripts/deploy-aws.sh status
aws-stop:
	./scripts/deploy-aws.sh stop
aws-start:
	./scripts/deploy-aws.sh start
aws-session:
	./scripts/deploy-aws.sh session
aws-logs:
	./scripts/deploy-aws.sh logs
aws-restart:
	./scripts/deploy-aws.sh restart
aws-destroy:
	./scripts/deploy-aws.sh destroy

help:
	@echo "nexora dev commands:"
	@echo "  make up       - start docker compose stack"
	@echo "  make down     - stop stack"
	@echo "  make logs     - follow api logs"
	@echo "  make api-test    - run go tests"
	@echo "  make ml-test     - run python tests"
	@echo "  make mobile-test - run mobile typecheck"
	@echo "  make ci          - run full local CI suite (go, python, mobile, shell)"
	@echo "  make git-hooks   - enable repo-local .githooks (pre-commit + commit-msg)"
	@echo "  make aws-smart   - auto-detect changed layers & deploy to AWS"
	@echo "  make aws-*       - AWS deploy/status/session/logs/restart/destroy"

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
	cd platform/api && go vet ./... && go test -race ./...

ml-test:
	cd intelligence/ml-platform && python3 -m pytest -v

mobile-test:
	cd apps/mobile && npm run typecheck

lint:
	cd platform/api && go vet ./...
	bash -n scripts/deploy-aws.sh infra/aws/remote-deploy.sh

ci: api-test ml-test mobile-test lint

git-hooks:
	chmod +x .githooks/pre-commit .githooks/commit-msg
	git config core.hooksPath .githooks
	@echo "Enabled .githooks (pre-commit + commit-msg)."

fmt:
	cd platform/api && go fmt ./...
