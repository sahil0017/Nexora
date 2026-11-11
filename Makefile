.PHONY: help up down logs build api-test ml-test fmt aws-deploy aws-status aws-stop aws-start aws-session aws-logs aws-restart aws-destroy

# AWS free-tier deployment (requires .env.aws — see infra/aws/env.aws.example)
aws-deploy:
	./scripts/deploy-aws.sh deploy
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
	@echo "  make api-test - run go tests"
	@echo "  make ml-test  - run python tests"
	@echo "  make aws-*    - AWS deploy/status/session/logs/restart/destroy"

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
	cd platform/api && go test ./...

ml-test:
	cd intelligence/ml-platform && python -m pytest

fmt:
	cd platform/api && go fmt ./...
