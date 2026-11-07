#!/bin/sh
# Restauration : ./backups/restore.sh backups/ecole_AAAAMMJJ_HHMMSS.sql.gz
# ATTENTION : remplace le contenu actuel de la base.
set -e
[ -f "$1" ] || { echo "Usage : $0 fichier.sql.gz"; exit 1; }
. ./.env
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};" -c "CREATE DATABASE ${POSTGRES_DB};"
gunzip -c "$1" | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
docker compose restart backend
echo "Restauration terminée."
