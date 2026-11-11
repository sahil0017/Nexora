# Deployment & LAN Operations Runbook

## 1. AWS Production Topology (`ap-south-1`)

Provisioned via [`infra/aws/template.yaml`](../../infra/aws/template.yaml) and orchestrated by [`scripts/deploy-aws.sh`](../../scripts/deploy-aws.sh):

| Component | AWS Resource / Service | Notes |
|---|---|---|
| **Compute** | EC2 (`nexora-free-tier`) via SSM | Runs `docker-compose.prod.yml` (`caddy`, `api`, `ml`, `redis`, one-shot `migrate`) |
| **Relational DB** | Amazon RDS PostgreSQL + PostGIS | External managed DB; schema migrated automatically (`0001`–`0005`) |
| **Docstore / Events** | DynamoDB (`nexora-dev-documents`), SNS, SQS | Serverless persistence & intelligence ingestion queue |
| **Artifacts / Registry** | S3 release bucket + Amazon ECR (`nexora/api`, `nexora/ml`) | Remote Docker builds & fast incremental deploys |
| **TLS Edge** | Caddy 2.9 (`infra/aws/Caddyfile`) | Automatic HTTPS on `<PublicIp>.sslip.io` (`https://43.205.135.43.sslip.io/api/v1`) |

---

## 2. Production AWS Commands

```bash
# One-time setup: copy infra/aws/env.aws.example -> .env.aws and set DB_PASSWORD
cp infra/aws/env.aws.example .env.aws

# Full deploy (CloudFormation + package release + build API/ML + push ECR + migrate RDS + start services)
./scripts/deploy-aws.sh deploy

# Smart diff-based deploy (auto-detects changed layers)
./scripts/deploy-aws.sh smart

# Targeted deploys
./scripts/deploy-aws.sh api      # rebuild Go API + migrate RDS + restart api
./scripts/deploy-aws.sh ml       # rebuild Python ML + restart ml
./scripts/deploy-aws.sh migrate  # run RDS SQL migrations only

# Inspection & ops
./scripts/deploy-aws.sh status
./scripts/deploy-aws.sh logs
./scripts/deploy-aws.sh session  # interactive SSM shell (no SSH keys required)
```

---

## 3. Running Mobile & Web on Local LAN

`apps/mobile` points to the live HTTPS AWS API by default (`https://43.205.135.43.sslip.io/api/v1` in [`apps/mobile/src/core/config/index.ts`](../../apps/mobile/src/core/config/index.ts)):

```bash
# Start Metro dev server bound to LAN IP (e.g. 192.168.x.x:8081)
EXPO_NO_TELEMETRY=1 npm --prefix apps/mobile start -- --host lan --port 8081
```

- **Expo Go (iOS / Android)**: Scan the terminal QR or enter `exp://<LAN_IP>:8081`.
- **Browser (Mobile / Desktop on LAN)**: Open `http://<LAN_IP>:8081`.
- **Static Web Bundle Export**:
  ```bash
  EXPO_NO_TELEMETRY=1 npm --prefix apps/mobile run export:web
  # Outputs optimized bundle into apps/mobile/dist/
  ```

---

## 4. Automated Test & Verification Suite

Run all three verification suites before any release:

```bash
# Python ML + 12-Pillar Digital Twin & Privacy tests
PYTHONPATH=intelligence/ml-platform/src python3 -m unittest discover -s intelligence/ml-platform/tests -v

# Go Control Plane & Digital Twin tests
go test -C platform/api -v -count=1 ./internal/modules/mobility/...

# Mobile TypeScript strict check
npm --prefix apps/mobile run typecheck
```
