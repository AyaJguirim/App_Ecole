#!/bin/sh
# Sauvegarde manuelle immédiate.
set -e
. ./.env
f="backups/ecole_$(date +%Y%m%d_%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$f"
echo "Sauvegarde créée : $f"
