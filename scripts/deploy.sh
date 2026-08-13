#!/usr/bin/env bash
set -Eeuo pipefail

JANUS_ROOT=${JANUS_ROOT:-/opt/janus-protect}
DEPLOY_REF=${DEPLOY_REF:-main}
HEALTH_TIMEOUT_SECONDS=${HEALTH_TIMEOUT_SECONDS:-60}
SKIP_PULL=false
PREVIOUS_COMMIT=''

usage() {
  echo 'Usage: scripts/deploy.sh [--ref <branch-or-tag>] [--skip-pull]'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      DEPLOY_REF=${2:?Missing value for --ref}
      shift 2
      ;;
    --skip-pull)
      SKIP_PULL=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

cd "${JANUS_ROOT}"

for command in git node pnpm composer docker pm2 curl; do
  command -v "${command}" >/dev/null || { echo "Missing required command: ${command}" >&2; exit 1; }
done

for file in .env .infra.env; do
  [[ -f ${file} ]] || { echo "Missing ${JANUS_ROOT}/${file}" >&2; exit 1; }
  [[ $(stat -c '%a' "${file}") == 600 ]] || chmod 600 "${file}"
done

if grep -Rq 'CHANGE_ME' .env .infra.env; then
  echo 'Replace all CHANGE_ME values before deploying.' >&2
  exit 1
fi

PREVIOUS_COMMIT=$(git rev-parse HEAD)
if [[ ${SKIP_PULL} == false ]]; then
  git fetch --tags origin
  if git show-ref --verify --quiet "refs/remotes/origin/${DEPLOY_REF}"; then
    git checkout "${DEPLOY_REF}"
    git pull --ff-only origin "${DEPLOY_REF}"
  else
    git checkout --detach "${DEPLOY_REF}"
  fi
fi

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Deployment failed; restoring ${PREVIOUS_COMMIT}." >&2
  git checkout --detach "${PREVIOUS_COMMIT}" || true
  pnpm install --frozen-lockfile || true
  pnpm --filter @janus/api build || true
  pnpm --filter @janus/worker-build build || true
  NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @janus/web build || true
  JANUS_ROOT="${JANUS_ROOT}" pm2 startOrReload deploy/ecosystem.config.cjs --update-env || true
  exit "${exit_code}"
}
trap rollback ERR

docker compose --env-file .infra.env -f deploy/compose.prod.yml up -d
postgres_deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until docker compose --env-file .infra.env -f deploy/compose.prod.yml exec -T postgres \
  pg_isready --username janus --dbname janus >/dev/null; do
  (( SECONDS < postgres_deadline )) || { echo 'PostgreSQL readiness check timed out.' >&2; false; }
  sleep 2
done
scripts/backup-database.sh
pnpm install --frozen-lockfile
composer install --working-dir=services/php-transformer --no-dev --no-interaction --no-progress --prefer-dist --optimize-autoloader
pnpm db:generate
pnpm db:migrate
pnpm --filter @janus/api build
pnpm --filter @janus/worker-build build

node -e "const fs=require('node:fs'); require('dotenv').config({path:'.env'}); if (!process.env.NEXT_PUBLIC_API_URL) throw new Error('NEXT_PUBLIC_API_URL is required'); fs.writeFileSync('apps/web/.env.production', 'NEXT_PUBLIC_API_URL=' + process.env.NEXT_PUBLIC_API_URL + '\\n', {mode:0o600})"
chmod 600 apps/web/.env.production
NODE_OPTIONS=--max-old-space-size=1536 pnpm --filter @janus/web build

JANUS_ROOT="${JANUS_ROOT}" pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

api_port=$(node -e "require('dotenv').config({path:'.env'}); process.stdout.write(process.env.API_PORT || '4100')")
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
until curl --fail --silent --show-error "http://127.0.0.1:${api_port}/health/ready" >/dev/null; do
  (( SECONDS < deadline )) || { echo 'API readiness check timed out.' >&2; false; }
  sleep 2
done
curl --fail --silent --show-error "http://127.0.0.1:${WEB_PORT:-3100}" >/dev/null

trap - ERR
echo "Deployed Janus Protect $(node -p "require('./package.json').version") at $(git rev-parse --short HEAD)."
