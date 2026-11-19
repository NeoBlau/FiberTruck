#!/usr/bin/env bash
# Обновление FiberTrack на сервере: свежий код → пересборка → перезапуск → проверка.
# Данные, пользователи и настройки сохраняются; миграции базы применяются сами.
#   cd /opt/fibertrack && sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
[ -f .env ] || die "Нет файла .env — FiberTrack здесь ещё не установлен."
if grep -q '^FT_PORT=' .env; then          # режим «за вашим nginx» (ставил install-behind-nginx.sh)
  COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.behind-proxy.yml)
  PORT=$(grep '^FT_PORT=' .env | cut -d= -f2)
  HEALTH="http://127.0.0.1:$PORT/api/health"
else
  COMPOSE=(docker compose)
  HEALTH=""
fi
say "1/4 Резервная копия перед обновлением"
# Только чтение текущей базы и файлов. Ошибка копирования останавливает обновление.
BACKUP_DIR="backups/before-update-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -p .env "$BACKUP_DIR/server.env"
chmod 600 "$BACKUP_DIR/server.env"
"${COMPOSE[@]}" exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' | gzip > "$BACKUP_DIR/database.sql.gz"
"${COMPOSE[@]}" exec -T backend tar -C /app/backend -czf - uploads > "$BACKUP_DIR/uploads.tar.gz"
gzip -t "$BACKUP_DIR/database.sql.gz"
tar -tzf "$BACKUP_DIR/uploads.tar.gz" >/dev/null
chmod 600 "$BACKUP_DIR/"*
echo "  сохранено: $BACKUP_DIR"
say "2/4 Код"
if [ -d .git ] && [ "${FT_NO_PULL:-}" != 1 ]; then
  git pull --ff-only || die "git pull не прошёл. Если меняли файлы проекта вручную — пришлите вывод git status."
else
  [ "${FT_NO_PULL:-}" = 1 ] || printf '\033[1;33m  Папка не из git — новая версия НЕ скачана. Распакуйте свежий архив fibertrack.zip поверх этой папки (.env не трогайте) и запустите скрипт снова.\033[0m\n'
  echo "  использую текущие файлы"
fi
say "3/4 Пересборка только программы (база и тома остаются на месте)"
if [ "${FT_NO_BUILD:-}" != 1 ]; then "${COMPOSE[@]}" build backend; fi
"${COMPOSE[@]}" up -d --no-deps backend
say "4/4 Проверка"
for i in $(seq 1 60); do
  if [ -n "$HEALTH" ]; then curl -fs "$HEALTH" >/dev/null 2>&1 && break
  else "${COMPOSE[@]}" exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')" >/dev/null 2>&1 && break; fi
  [ "$i" = 60 ] && die "FiberTrack не ответил за 2 минуты: ${COMPOSE[*]} logs backend"
  sleep 2
done
if [ "${FT_IMPORT_REVIEWED_BUNDLE:-0}" = 1 ]; then
  say "Проверенный пакет: замена данных только перечисленных машин и общих строк за месяцы пакета"
  echo "  Прежние значения сохраняются для отката. Другие месяцы и неперечисленные машины не меняются."
  if [ -n "${FT_BUNDLE_KEY_FILE:-}" ]; then
    [ -f "$FT_BUNDLE_KEY_FILE" ] || die "Не найден файл ключа пакета. Код обновлён; импорт не запущен."
    IFS= read -r FT_PACKAGE_SECRET < "$FT_BUNDLE_KEY_FILE"
  else
    [ -t 0 ] || die "Для импорта нужен терминал или FT_BUNDLE_KEY_FILE. Код обновлён; импорт не запущен."
    IFS= read -r -s -p 'Ключ пакета (ввод не отображается): ' FT_PACKAGE_SECRET
    printf '\n'
  fi
  if ! printf '%s\n' "$FT_PACKAGE_SECRET" | "${COMPOSE[@]}" exec -T backend python -m app.cli reviewed-package --key-stdin --apply; then
    unset FT_PACKAGE_SECRET
    die "Код обновлён, пакет не применён. Изменения импорта отменены; резервная копия: $BACKUP_DIR"
  fi
  unset FT_PACKAGE_SECRET
fi
echo "  версия базы: $("${COMPOSE[@]}" exec -T backend alembic current 2>/dev/null | tail -1)"
[ -d .git ] && echo "  версия кода: $(git log -1 --format='%h от %cd' --date=format:'%d.%m.%Y %H:%M')"
printf '\n\033[1;32mГотово — FiberTrack обновлён.\033[0m\n'
