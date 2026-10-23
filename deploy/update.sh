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
say "1/3 Код"
if [ -d .git ] && [ "${FT_NO_PULL:-}" != 1 ]; then
  git pull --ff-only || die "git pull не прошёл. Если меняли файлы проекта вручную — пришлите вывод git status."
else
  echo "  код не обновляю (папка не из git или FT_NO_PULL=1) — использую текущие файлы"
fi
say "2/3 Пересборка и перезапуск (данные сохраняются)"
if [ "${FT_NO_BUILD:-}" = 1 ]; then "${COMPOSE[@]}" up -d; else "${COMPOSE[@]}" up -d --build; fi
say "3/3 Проверка"
for i in $(seq 1 60); do
  if [ -n "$HEALTH" ]; then curl -fs "$HEALTH" >/dev/null 2>&1 && break
  else "${COMPOSE[@]}" exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')" >/dev/null 2>&1 && break; fi
  [ "$i" = 60 ] && die "FiberTrack не ответил за 2 минуты: ${COMPOSE[*]} logs backend"
  sleep 2
done
echo "  версия базы: $("${COMPOSE[@]}" exec -T backend alembic current 2>/dev/null | tail -1)"
printf '\n\033[1;32mГотово — FiberTrack обновлён.\033[0m\n'
