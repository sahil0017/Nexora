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
PREBUILT="${PREBUILT_IMAGES:-0}"
if [ "$TARGET" = "all" ] || [ "$TARGET" = "api" ]; then
  export API_IMAGE="${REG}/nexora/api:${RELEASE_TAG}"
  grep -q '^API_IMAGE=' ./.env.aws && sed -i "s|^API_IMAGE=.*|API_IMAGE=${API_IMAGE}|" ./.env.aws || printf 'API_IMAGE=%s\n' "$API_IMAGE" >> ./.env.aws
fi
if [ "$TARGET" = "all" ] || [ "$TARGET" = "ml" ]; then
  export ML_IMAGE="${REG}/nexora/ml:${RELEASE_TAG}"
  grep -q '^ML_IMAGE=' ./.env.aws && sed -i "s|^ML_IMAGE=.*|ML_IMAGE=${ML_IMAGE}|" ./.env.aws || printf 'ML_IMAGE=%s\n' "$ML_IMAGE" >> ./.env.aws
fi

ecr_login() {
  echo "==> ECR login ($REG)"
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REG"
}

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
    if [ "$PREBUILT" = "1" ]; then
      ecr_login
      echo "==> Pulling prebuilt Go API image ($API_IMAGE)"
      docker pull -q "$API_IMAGE"
    else
      echo "==> Fast-building Go API image ($API_IMAGE)"
      DOCKER_BUILDKIT=0 docker build -q -t "$API_IMAGE" platform/api
    fi
    echo "==> Migrating RDS schema"
    $C run --rm migrate
    echo "==> Restarting api container only"
    $C up -d --no-deps api
    ;;
  ml)
    if [ "$PREBUILT" = "1" ]; then
      ecr_login
      echo "==> Pulling prebuilt Python ML image ($ML_IMAGE)"
      docker pull -q "$ML_IMAGE"
    else
      echo "==> Fast-building Python ML image ($ML_IMAGE)"
      DOCKER_BUILDKIT=0 docker build -q -t "$ML_IMAGE" intelligence/ml-platform
    fi
    echo "==> Restarting ml container only"
    $C up -d --no-deps ml
    ;;
  all)
    ecr_login

    if [ "$PREBUILT" = "1" ]; then
      echo "==> Pulling prebuilt Go API + Python ML images"
      docker pull -q "$API_IMAGE"
      docker pull -q "$ML_IMAGE"
    else
      echo "==> Building Go API image ($API_IMAGE)"
      DOCKER_BUILDKIT=0 docker build -q -t "$API_IMAGE" platform/api
      echo "==> Building Python ML image ($ML_IMAGE)"
      DOCKER_BUILDKIT=0 docker build -q -t "$ML_IMAGE" intelligence/ml-platform

      echo "==> Pushing images to ECR"
      docker push -q "$API_IMAGE"
      docker push -q "$ML_IMAGE"
    fi

    echo "==> Migrating RDS schema"
    $C run --rm migrate

    echo "==> Starting services"
    $C up -d --remove-orphans redis api ml caddy
    ln -sfn "$REL" /opt/nexora/current
    ;;
esac

# Keep free-tier 30 GB EBS clean by pruning dangling/stale images older than 72h.
docker image prune -f --filter "until=72h" >/dev/null 2>&1 || true

sleep 2
$C ps
echo "==> Health"
for _ in $(seq 1 10); do
  if curl -fsS -m 5 http://localhost:8080/api/v1/healthz; then
    echo
    echo "DEPLOY_OK ${RELEASE_TAG} (${TARGET})"
    exit 0
  fi
  sleep 2
done
echo "ERROR: health check failed after deploy" >&2
exit 1
