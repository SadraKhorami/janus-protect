#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo 'Run this script as root.' >&2
  exit 1
fi

JANUS_ROOT=${JANUS_ROOT:-/opt/janus-protect}
JANUS_REPOSITORY=${JANUS_REPOSITORY:-https://github.com/SadraKhorami/janus-protect.git}
JANUS_REF=${JANUS_REF:-main}
SWAP_SIZE=${SWAP_SIZE:-4G}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git docker.io docker-compose-v2 php-cli php-zip composer
systemctl enable --now docker

if ! command -v node >/dev/null || [[ $(node -p 'Number(process.versions.node.split(".")[0])') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

corepack enable
corepack prepare pnpm@10.26.0 --activate
command -v pm2 >/dev/null || npm install --global pm2@7

if [[ ! -d ${JANUS_ROOT}/.git ]]; then
  git clone --branch "${JANUS_REF}" --single-branch "${JANUS_REPOSITORY}" "${JANUS_ROOT}"
fi

cd "${JANUS_ROOT}"
git fetch --tags origin
git checkout "${JANUS_REF}"
git pull --ff-only origin "${JANUS_REF}"

if [[ ! -f .env ]]; then
  cp deploy/env.production.example .env
  chmod 600 .env
  echo "Edit ${JANUS_ROOT}/.env before deployment." >&2
fi

if [[ ! -f .infra.env ]]; then
  cp deploy/infra.env.example .infra.env
  chmod 600 .infra.env
  echo "Edit ${JANUS_ROOT}/.infra.env before deployment." >&2
fi

if [[ ${SWAP_SIZE} != 0 && ! -f /swapfile ]]; then
  fallocate -l "${SWAP_SIZE}" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

pm2 startup systemd -u root --hp /root >/dev/null || true

if grep -Rq 'CHANGE_ME' .env .infra.env; then
  echo 'Setup completed, but deployment stopped because CHANGE_ME values remain.' >&2
  echo "Configure ${JANUS_ROOT}/.env and ${JANUS_ROOT}/.infra.env, then run scripts/deploy.sh." >&2
  exit 2
fi

exec scripts/deploy.sh --ref "${JANUS_REF}"
