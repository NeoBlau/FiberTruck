#!/bin/sh
# Ежедневный бэкап базы в ./backups, хранится KEEP_DAYS дней.
set -eu
while true; do
  f="/backups/fibertrack_$(date +%Y-%m-%d_%H%M).sql.gz"
  if pg_dump -h db -U fibertrack fibertrack | gzip > "$f.tmp"; then
    mv "$f.tmp" "$f" && echo "бэкап: $f"
  else
    rm -f "$f.tmp"; echo "бэкап НЕ удался" >&2
  fi
  find /backups -name 'fibertrack_*.sql.gz' -mtime +"$KEEP_DAYS" -delete
  sleep 86400
done
