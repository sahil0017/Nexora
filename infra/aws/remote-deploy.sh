#!/usr/bin/env bash
# NEXORA — runs ON the EC2 instance (invoked via SSM by scripts/deploy-aws.sh).
# Usage: remote-deploy.sh <release-dir> [all|api|ml|migrate|config] [optional-compose-service...]
set -euo pipefail
REL="$1"
TARGET="${2:-all}"
shift $(( $# >= 2 ? 2 : $# ))
EXTRA_SERVICES=("$@")

cd "$REL"
set -a; source ./.env.aws; set +a

REG="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
  export API_IMAGE="${REG}/nexora/api:${RELEASE_TAG}"
  grep -q '^API_IMAGE=' ./.env.aws && sed -i "s|^API_IMAGE=.*|API_IMAGE=${API_IMAGE}|" ./.env.aws || printf 'API_IMAGE=%s\n' "$API_IMAGE" >> ./.env.aws
fi
if [ "$TARGET" = "all" ] || [ "$TARGET" = "ml" ]; then
  export ML_IMAGE="${REG}/nexora/ml:${RELEASE_TAG}"
  grep -q '^ML_IMAGE=' ./.env.aws && sed -i "s|^ML_IMAGE=.*|ML_IMAGE=${ML_IMAGE}|" ./.env.aws || printf 'ML_IMAGE=%s\n' "$ML_IMAGE" >> ./.env.aws
fi

C="docker compose -f infra/aws/docker-compose.prod.yml --env-file ./.env.aws"

case "$TARGET" in
  migrate)
    echo "==> Running RDS SQL migrations only (no image builds, no service restarts)"
    $C run --rm migrate
    ;;
  config)
    if [ "${#EXTRA_SERVICES[@]}" -gt 0 ]; then
      echo "==> Applying compose/env config to: ${EXTRA_SERVICES[*]} (no image builds)"
      $C up -d --no-deps "${EXTRA_SERVICES[@]}"
    else
      echo "==> Applying compose/env config across services (no image builds)"
      $C up -d --remove-orphans redis api ml caddy
    fi
    ;;
  api)
    echo "==> Fast-building Go API image ($API_IMAGE)"
    DOCKER_BUILDKIT=0 docker build -q -t "$API_IMAGE" platform/api
    echo "==> Migrating RDS schema"
    $C run --rm migrate
    echo "==> Restarting api container only"
    $C up -d --no-deps api
    ;;
  ml)
    echo "==> Fast-building Python ML image ($ML_IMAGE)"
    DOCKER_BUILDKIT=0 docker build -q -t "$ML_IMAGE" intelligence/ml-platform
    echo "==> Restarting ml container only"
    $C up -d --no-deps ml
    ;;
  all)
    echo "==> ECR login ($REG)"
    aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REG"

    echo "==> Building Go API image ($API_IMAGE)"
    DOCKER_BUILDKIT=0 docker build -q -t "$API_IMAGE" platform/api
    echo "==> Building Python ML image ($ML_IMAGE)"
    DOCKER_BUILDKIT=0 docker build -q -t "$ML_IMAGE" intelligence/ml-platform

    echo "==> Pushing images to ECR"
    docker push -q "$API_IMAGE"
    docker push -q "$ML_IMAGE"

    echo "==> Migrating RDS schema"
    $C run --rm migrate

    echo "==> Starting services"
    $C up -d --remove-orphans redis api ml caddy
    ln -sfn "$REL" /opt/nexora/current
    ;;
esac

sleep 2
$C ps
echo "==> Health"
curl -fsS -m 10 http://localhost:8080/api/v1/healthz && echo
echo "DEPLOY_OK ${RELEASE_TAG} (${TARGET})"
