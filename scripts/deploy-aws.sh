#!/usr/bin/env bash
# NEXORA — one-command deploy to AWS free tier (SSM-based, no SSH needed)
#
# Prereqs (one-time):
#   1. AWS CLI v2 configured (`aws configure`). ~/aws-cli/aws is used if `aws` is broken.
#   2. cp infra/aws/env.aws.example .env.aws  and set DB_PASSWORD.
#
# Usage:
#   ./scripts/deploy-aws.sh smart              # auto-detect changed layer(s) and deploy only what changed
#   ./scripts/deploy-aws.sh migrate            # run SQL migrations ONLY (~5s, no image builds/restarts)
#   ./scripts/deploy-aws.sh config [svc...]    # apply compose/env/redis/caddy/db config ONLY (~5s, no builds)
#   ./scripts/deploy-aws.sh infra              # update CloudFormation (RDS/SQS/SNS/IAM/DDB) + sync .env.aws ONLY
#   ./scripts/deploy-aws.sh api                # fast-deploy ONLY Go API + migrations (~20-30s)
#   ./scripts/deploy-aws.sh ml                 # fast-deploy ONLY Python ML service
#   ./scripts/deploy-aws.sh deploy             # full stack + build all + migrate + start
#   ./scripts/deploy-aws.sh status             # stack outputs + health
#   ./scripts/deploy-aws.sh session            # SSM shell on the instance
#   ./scripts/deploy-aws.sh logs               # tail api/ml logs
#   ./scripts/deploy-aws.sh restart            # restart services
#   ./scripts/deploy-aws.sh destroy            # tear down (RDS snapshot kept, DynamoDB table kept)
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-nexora-free-tier}"
REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

AWS="aws"
if ! aws --version >/dev/null 2>&1; then AWS="$HOME/aws-cli/aws"; fi

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31mERROR: %s\033[0m\n" "$*" >&2; exit 1; }

need_env() {
  [ -f .env.aws ] || die ".env.aws not found. Copy infra/aws/env.aws.example to .env.aws and fill it in."
  set -a; source .env.aws; set +a
  [ -n "${DB_PASSWORD:-}" ] && [ "$DB_PASSWORD" != "CHANGE_ME" ] || die "set DB_PASSWORD in .env.aws (openssl rand -hex 16)"
}

stack_output() {
  "$AWS" cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# ssm_run <timeout-seconds> <command...>  — runs a shell command on the instance, prints output.
ssm_run() {
  local timeout="$1"; shift
  local iid; iid="$(stack_output InstanceId)"
  local params; params="$(python3 -c 'import json,sys; print(json.dumps({"commands": sys.argv[2:], "executionTimeout": [sys.argv[1]]}))' "$timeout" "$@")"
  local cid; cid="$("$AWS" ssm send-command --instance-ids "$iid" --document-name AWS-RunShellScript \
    --timeout-seconds 600 --parameters "$params" --output text --query Command.CommandId)"
  local status="Pending"
  for _ in $(seq 1 $(( timeout / 5 + 10 ))); do
    sleep 5
    status="$("$AWS" ssm get-command-invocation --command-id "$cid" --instance-id "$iid" \
      --query Status --output text 2>/dev/null || echo Pending)"
    case "$status" in Pending|InProgress|Delayed) continue ;; *) break ;; esac
  done
  "$AWS" ssm get-command-invocation --command-id "$cid" --instance-id "$iid" \
    --query "[StandardOutputContent, StandardErrorContent]" --output text | tail -n 80
  [ "$status" = "Success" ] || die "remote command finished with status: $status"
}

wait_ssm() {
  step "Waiting for instance to register with SSM + finish bootstrap (~2-4 min on first boot)"
  local iid; iid="$(stack_output InstanceId)"
  for i in $(seq 1 60); do
    local ping; ping="$("$AWS" ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$iid" --query "InstanceInformationList[0].PingStatus" --output text 2>/dev/null || true)"
    if [ "$ping" = "Online" ]; then
      if ssm_run 30 "test -f /opt/nexora/.bootstrap-status && echo READY" 2>/dev/null | grep -q READY; then
        echo "instance READY"; return 0
      fi
    fi
    echo "  ...waiting ($i/60, ssm=$ping)"; sleep 10
  done
  die "instance not ready; check /var/log/nexora-userdata.log via: $0 session"
}

deploy() {
  need_env
  step "Deploying CloudFormation stack '$STACK' in $REGION (free tier)"
  "$AWS" cloudformation deploy \
    --template-file infra/aws/template.yaml \
    --stack-name "$STACK" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides \
      EnvironmentName="${ENVIRONMENT_NAME:-dev}" \
      InstanceType="${INSTANCE_TYPE:-t3.micro}" \
      AdminCidr="${ADMIN_CIDR:-}" \
      KeyPairName="${KEY_PAIR_NAME:-}" \
      DocumentsTableName="${DDB_DOCS_TABLE:-nexora-dev-documents}" \
      DBUsername="${DB_USERNAME:-nexora}" \
      DBPassword="$DB_PASSWORD"

  local bucket account rds_host rds_port sns_topic sqs_queue public_ip tag
  bucket="$(stack_output ArtifactsBucket)"
  account="$(stack_output AccountId)"
  rds_host="$(stack_output DBEndpoint)"
  rds_port="$(stack_output DBPort)"
  sns_topic="$(stack_output EventsTopicArn)"
  sqs_queue="$(stack_output IntelligenceQueueUrl)"
  public_ip="$(stack_output PublicIp)"
  tag="$(date -u +%Y%m%d%H%M%S)"
  echo "RDS: $rds_host:$rds_port   bucket: $bucket   SNS: $sns_topic   SQS: $sqs_queue   domain: ${public_ip}.sslip.io   release: $tag"

  step "Packaging release $tag"
  local tmp; tmp="$(mktemp -d)"
  {
    echo "AWS_REGION=$REGION"
    echo "AWS_ACCOUNT_ID=$account"
    echo "RELEASE_TAG=$tag"
    echo "PUBLIC_DOMAIN=${public_ip}.sslip.io"
    echo "DDB_DOCS_TABLE=${DDB_DOCS_TABLE:-nexora-dev-documents}"
    echo "DB_USERNAME=${DB_USERNAME:-nexora}"
    echo "DB_PASSWORD=$DB_PASSWORD"
    echo "RDS_ENDPOINT=$rds_host"
    echo "RDS_PORT=$rds_port"
    echo "SNS_EVENTS_TOPIC_ARN=$sns_topic"
    echo "SQS_INTELLIGENCE_QUEUE_URL=$sqs_queue"
  } > "$tmp/.env.aws"
  COPYFILE_DISABLE=1 tar -czf "$tmp/release.tgz" \
    --exclude '.DS_Store' --exclude '__pycache__' --exclude '*.pyc' \
    platform/api intelligence/ml-platform infra/aws infra/postgres \
    -C "$tmp" .env.aws
  "$AWS" s3 cp --only-show-errors "$tmp/release.tgz" "s3://$bucket/releases/$tag.tgz"
  rm -rf "$tmp"

  wait_ssm

  step "Building Go + Python images on instance, migrating RDS, starting services (~5-10 min)"
  local rel="/opt/nexora/releases/$tag"
  ssm_run 1800 \
    "set -euo pipefail" \
    "mkdir -p $rel && cd $rel" \
    "aws s3 cp --only-show-errors s3://$bucket/releases/$tag.tgz release.tgz --region $REGION" \
    "tar -xzf release.tgz && rm release.tgz" \
    "bash infra/aws/remote-deploy.sh $rel"

  step "Deployment complete. API: $(stack_output ApiUrl)"
}

deploy_service() {
  local svc="$1"
  need_env
  local bucket tag
  bucket="$(stack_output ArtifactsBucket)"
  tag="$(date -u +%Y%m%d%H%M%S)"
  step "Fast-packaging service '$svc' ($tag)"
  local tmp; tmp="$(mktemp -d)"
  if [ "$svc" = "api" ]; then
    COPYFILE_DISABLE=1 tar -czf "$tmp/patch.tgz" \
      --exclude '.DS_Store' \
      platform/api infra/aws infra/postgres
  else
    COPYFILE_DISABLE=1 tar -czf "$tmp/patch.tgz" \
      --exclude '.DS_Store' --exclude '__pycache__' --exclude '*.pyc' \
      intelligence/ml-platform infra/aws
  fi
  "$AWS" s3 cp --only-show-errors "$tmp/patch.tgz" "s3://$bucket/releases/${tag}-${svc}.tgz"
  rm -rf "$tmp"

  step "Fast-deploying '$svc' on instance"
  ssm_run 600 \
    "set -euo pipefail" \
    "cd /opt/nexora/current" \
    "aws s3 cp --only-show-errors s3://$bucket/releases/${tag}-${svc}.tgz patch.tgz --region $REGION" \
    "tar -xzf patch.tgz && rm patch.tgz" \
    "sed -i \"s/^RELEASE_TAG=.*/RELEASE_TAG=${tag}/\" ./.env.aws" \
    "bash infra/aws/remote-deploy.sh /opt/nexora/current $svc"
}

remote_compose() {
  ssm_run 300 "cd /opt/nexora/current && docker compose -f infra/aws/docker-compose.prod.yml --env-file ./.env.aws $*"
}

status() {
  step "Stack outputs"
  "$AWS" cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs" --output table 2>/dev/null || die "stack '$STACK' not found"
  local url; url="$(stack_output ApiUrl)"
  step "Health check $url"
  curl -s -m 10 "$url" && echo || echo "(unreachable)"
}

destroy() {
  local bucket; bucket="$(stack_output ArtifactsBucket 2>/dev/null || true)"
  if [ -n "$bucket" ] && [ "$bucket" != "None" ]; then
    "$AWS" s3 rm --recursive --only-show-errors "s3://$bucket" || true
  fi
  "$AWS" cloudformation delete-stack --stack-name "$STACK"
  echo "Deleting stack (RDS final snapshot is kept; DynamoDB table is not managed by the stack)."
}

deploy_migrate() {
  need_env
  local bucket tag
  bucket="$(stack_output ArtifactsBucket)"
  tag="$(date -u +%Y%m%d%H%M%S)"
  step "Shipping SQL migrations only ($tag)"
  local tmp; tmp="$(mktemp -d)"
  COPYFILE_DISABLE=1 tar -czf "$tmp/migrate.tgz" \
    --exclude '.DS_Store' \
    platform/api/migrations infra/postgres infra/aws/remote-deploy.sh infra/aws/docker-compose.prod.yml
  "$AWS" s3 cp --only-show-errors "$tmp/migrate.tgz" "s3://$bucket/releases/${tag}-migrate.tgz"
  rm -rf "$tmp"

  step "Executing migrations against RDS (no service rebuilds)"
  ssm_run 180 \
    "set -euo pipefail" \
    "cd /opt/nexora/current" \
    "aws s3 cp --only-show-errors s3://$bucket/releases/${tag}-migrate.tgz migrate.tgz --region $REGION" \
    "tar -xzf migrate.tgz && rm migrate.tgz" \
    "bash infra/aws/remote-deploy.sh /opt/nexora/current migrate"
}

write_env_file() {
  local out="$1" tag="$2"
  local account rds_host rds_port sns_topic sqs_queue public_ip
  account="$(stack_output AccountId)"
  rds_host="$(stack_output DBEndpoint)"
  rds_port="$(stack_output DBPort)"
  sns_topic="$(stack_output EventsTopicArn)"
  sqs_queue="$(stack_output IntelligenceQueueUrl)"
  public_ip="$(stack_output PublicIp)"
  {
    echo "AWS_REGION=$REGION"
    echo "AWS_ACCOUNT_ID=$account"
    echo "RELEASE_TAG=$tag"
    echo "PUBLIC_DOMAIN=${public_ip}.sslip.io"
    echo "DDB_DOCS_TABLE=${DDB_DOCS_TABLE:-nexora-dev-documents}"
    echo "DB_USERNAME=${DB_USERNAME:-nexora}"
    echo "DB_PASSWORD=$DB_PASSWORD"
    echo "RDS_ENDPOINT=$rds_host"
    echo "RDS_PORT=$rds_port"
    echo "SNS_EVENTS_TOPIC_ARN=$sns_topic"
    echo "SQS_INTELLIGENCE_QUEUE_URL=$sqs_queue"
  } > "$out"
}

deploy_config() {
  need_env
  local bucket tag
  bucket="$(stack_output ArtifactsBucket)"
  tag="$(date -u +%Y%m%d%H%M%S)"
  step "Shipping compose/env/container config only ($tag)"
  local tmp; tmp="$(mktemp -d)"
  write_env_file "$tmp/.env.aws.new" "$tag"
  COPYFILE_DISABLE=1 tar -czf "$tmp/config.tgz" \
    --exclude '.DS_Store' \
    infra/aws infra/postgres -C "$tmp" .env.aws.new
  "$AWS" s3 cp --only-show-errors "$tmp/config.tgz" "s3://$bucket/releases/${tag}-config.tgz"
  rm -rf "$tmp"

  step "Applying config on instance (${*:-all services})"
  ssm_run 180 \
    "set -euo pipefail" \
    "cd /opt/nexora/current" \
    "aws s3 cp --only-show-errors s3://$bucket/releases/${tag}-config.tgz config.tgz --region $REGION" \
    "tar -xzf config.tgz && rm config.tgz" \
    "grep -E '^(API_IMAGE|ML_IMAGE)=' ./.env.aws >> ./.env.aws.new || true" \
    "mv ./.env.aws.new ./.env.aws" \
    "bash infra/aws/remote-deploy.sh /opt/nexora/current config $*"
}

deploy_infra() {
  need_env
  step "Updating CloudFormation stack '$STACK' only (RDS / DynamoDB / SQS / SNS / IAM)"
  "$AWS" cloudformation deploy \
    --template-file infra/aws/template.yaml \
    --stack-name "$STACK" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides \
      EnvironmentName="${ENVIRONMENT_NAME:-dev}" \
      InstanceType="${INSTANCE_TYPE:-t3.micro}" \
      AdminCidr="${ADMIN_CIDR:-}" \
      KeyPairName="${KEY_PAIR_NAME:-}" \
      DocumentsTableName="${DDB_DOCS_TABLE:-nexora-dev-documents}" \
      DBUsername="${DB_USERNAME:-nexora}" \
      DBPassword="$DB_PASSWORD"
  deploy_config "$@"
}

deploy_smart() {
  local changed
  changed="$(git status --porcelain | awk '{print $2}')"
  if [ -z "$changed" ]; then
    echo "No uncommitted changes detected; checking last commit diff..."
    changed="$(git diff --name-only HEAD~1..HEAD 2>/dev/null || true)"
  fi
  echo "Changed files:"
  echo "$changed" | sed 's/^/  - /'

  local need_infra=0 need_api=0 need_ml=0 need_migrate=0 need_config=0
  echo "$changed" | grep -q '^infra/aws/template\.yaml$' && need_infra=1 || true
  echo "$changed" | grep -qE '^platform/api/.*\.(go|mod|sum)$|^platform/api/Dockerfile$' && need_api=1 || true
  echo "$changed" | grep -qE '^intelligence/ml-platform/' && need_ml=1 || true
  echo "$changed" | grep -qE '^platform/api/migrations/|^infra/postgres/' && need_migrate=1 || true
  echo "$changed" | grep -qE '^infra/aws/(docker-compose\.prod\.yml|Caddyfile)$' && need_config=1 || true

  if [ "$need_infra" -eq 1 ]; then deploy_infra; fi
  if [ "$need_config" -eq 1 ] && [ "$need_infra" -eq 0 ]; then deploy_config; fi
  if [ "$need_api" -eq 1 ]; then
    deploy_service api
  elif [ "$need_migrate" -eq 1 ]; then
    deploy_migrate
  fi
  if [ "$need_ml" -eq 1 ]; then deploy_service ml; fi
  if [ "$need_infra" -eq 0 ] && [ "$need_config" -eq 0 ] && [ "$need_api" -eq 0 ] && [ "$need_migrate" -eq 0 ] && [ "$need_ml" -eq 0 ]; then
    echo "No backend/infra changes detected to deploy."
  fi
}

case "${1:-deploy}" in
  deploy)  deploy ;;
  smart)   deploy_smart ;;
  migrate) deploy_migrate ;;
  config)  shift; deploy_config "$@" ;;
  redis|caddy|redpanda) deploy_config "$1" ;;
  infra)   shift; deploy_infra "$@" ;;
  api)     deploy_service api ;;
  ml)      deploy_service ml ;;
  status)  status ;;
  session) "$AWS" ssm start-session --target "$(stack_output InstanceId)" ;;
  logs)    remote_compose "logs --tail 100 api ml" ;;
  restart) remote_compose "restart api ml" ;;
  destroy) destroy ;;
  *) echo "usage: $0 {smart|migrate|config|infra|redis|caddy|api|ml|deploy|status|session|logs|restart|destroy}"; exit 1 ;;
esac
