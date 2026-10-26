#!/usr/bin/env bash
# Automated PostgreSQL Backup Script for Waypoint
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups/waypoint}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/waypoint_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting PostgreSQL backup..."
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U waypoint waypoint | gzip > "${FILENAME}"
echo "[$(date)] Backup completed successfully: ${FILENAME} ($(du -h "${FILENAME}" | cut -f1))"

# Retain last 14 days of backups, purge older
find "${BACKUP_DIR}" -type f -name "waypoint_*.sql.gz" -mtime +14 -delete
echo "[$(date)] Pruning completed. Retained last 14 days of backups."
