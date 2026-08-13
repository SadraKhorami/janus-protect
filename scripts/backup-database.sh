#!/usr/bin/env bash
set -Eeuo pipefail

JANUS_ROOT=${JANUS_ROOT:-/opt/janus-protect}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/janus-protect}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}

cd "${JANUS_ROOT}"
[[ -f .infra.env ]] || { echo "Missing ${JANUS_ROOT}/.infra.env" >&2; exit 1; }

install -d -m 700 "${BACKUP_DIR}"
backup="${BACKUP_DIR}/janus-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose --env-file .infra.env -f deploy/compose.prod.yml exec -T postgres \
  pg_dump --username janus --dbname janus --format custom --no-owner --no-privileges > "${backup}"

chmod 600 "${backup}"
find "${BACKUP_DIR}" -type f -name 'janus-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
echo "Database backup created: ${backup}"
