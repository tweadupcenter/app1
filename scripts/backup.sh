#!/usr/bin/env bash
# Sauvegarde base + fichiers. Usage : DATABASE_ADMIN_URL=… STORAGE_DIR=./storage BACKUP_DIR=./backups scripts/backup.sh
# À planifier quotidiennement (cron). Conserve les BACKUP_KEEP_DAYS derniers jours (14 par défaut).
set -euo pipefail
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL requis}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"
pg_dump -Fc --no-owner -d "$DATABASE_ADMIN_URL" -f "$BACKUP_DIR/immo360-$STAMP.dump"
tar czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'immo360-*.dump' -o -name 'storage-*.tar.gz' \) -mtime +"$KEEP" -print -delete
echo "Sauvegarde terminée : $BACKUP_DIR (immo360-$STAMP.dump, storage-$STAMP.tar.gz)"
