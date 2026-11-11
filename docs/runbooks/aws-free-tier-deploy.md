# NEXORA — AWS Free-Tier Deployment Runbook

> See also the full wiki guide: [`docs/wiki/Deployment-and-LAN-Runbook.md`](../wiki/Deployment-and-LAN-Runbook.md).

## Provisioned Stack (`nexora-free-tier`)

| Resource | Spec | Notes |
|---|---|---|
| **EC2** | Free-tier instance (`i-*`) managed via SSM | Runs `redis`, `api` (Go), `ml` (Python), `caddy` (`80`/`443`) + one-shot `migrate` |
| **RDS PostgreSQL** | Managed PostgreSQL + PostGIS (`5432`) | Migrations `0001`–`0005` applied automatically by `migrate` container |
| **DynamoDB** | `nexora-dev-documents` (On-demand) | Document persistence |
| **SNS / SQS / S3 / ECR** | Event bus, ML ingestion queue, S3 release tarballs, ECR image repos | Zero SSH keys needed; SSM handles remote orchestration |

## One-time setup

```bash
aws configure
cp infra/aws/env.aws.example .env.aws
# Set DB_PASSWORD (e.g. openssl rand -hex 24)
```

## Deploy & Operate

```bash
./scripts/deploy-aws.sh deploy   # full stack + build Go/ML + push ECR + migrate RDS + start
./scripts/deploy-aws.sh smart    # auto-detect changed layers only
./scripts/deploy-aws.sh status   # CloudFormation outputs + live health check
./scripts/deploy-aws.sh logs     # tail remote api & ml container logs
./scripts/deploy-aws.sh session  # open AWS SSM shell on EC2
./scripts/deploy-aws.sh destroy  # tear down stack cleanly
```

## Free-tier guardrails

- Run `docker system prune -f` periodically via `./scripts/deploy-aws.sh session` to keep EC2 EBS usage low.
- Container memory caps in `infra/aws/docker-compose.prod.yml`: `redis` `64M`, `api` `192M`, `ml` `256M`, `caddy` `64M`.
- Configure an AWS CloudWatch Billing alarm if running beyond free-tier credits.
