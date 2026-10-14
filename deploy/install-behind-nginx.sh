#!/usr/bin/env bash
# Установка FiberTrack на сервер, где nginx уже занимает порты 80 и 443 (там работает другой сайт).
# Ваш сайт не трогается: добавляется отдельный конфиг nginx только для домена FiberTrack.
#
# Запуск из папки проекта:
#   sudo bash deploy/install-behind-nginx.sh fibertrack.ваш-домен.ru [почта-для-сертификата]
# Повторный запуск безопасен: обновит код и перезапустит FiberTrack, настройки и данные сохранятся.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
PORT="${FT_PORT:-8001}"
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f docker-compose.yml -f deploy/docker-compose.behind-proxy.yml)
MARK='# fibertrack: создано deploy/install-behind-nginx.sh'

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "Укажите домен: sudo bash deploy/install-behind-nginx.sh fibertrack.ваш-домен.ru"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Домен выглядит странно: $DOMAIN"
[ "$(id -u)" = 0 ] || die "Запустите через sudo"
command -v nginx >/dev/null || die "nginx не найден. Этот скрипт — для сервера, где nginx уже стоит. Иначе ставьте по README («Деплой на VPS»)."

say "1/6 Проверяю, что текущий nginx исправен (до любых изменений)"
nginx -t >/dev/null 2>&1 || die "nginx уже сейчас с ошибкой в конфигурации (см. sudo nginx -t). Ничего не меняю — сначала исправьте её."
ok "nginx в порядке"

say "2/6 Docker"
if ! command -v docker >/dev/null; then
  warn "Docker не установлен — ставлю официальный (nginx и ваш сайт это не затрагивает)"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Не найден docker compose. Установите: apt-get install -y docker-compose-plugin"
ok "$(docker --version)"

say "3/6 Порт $PORT"
if ss -tln | grep -q "127.0.0.1:$PORT \|0.0.0.0:$PORT \|\[::\]:$PORT \|\*:$PORT "; then
  if [ "$("${COMPOSE[@]}" port backend 8000 2>/dev/null)" = "127.0.0.1:$PORT" ]; then
    ok "порт занят самим FiberTrack — обновляю"
  else
    die "Порт $PORT занят другой программой. Запустите с другим портом: sudo FT_PORT=8002 bash deploy/install-behind-nginx.sh $DOMAIN"
  fi
else
  ok "свободен"
fi

say "4/6 Настройки и запуск FiberTrack"
if [ ! -f .env ]; then
  umask 077
  printf 'DB_PASSWORD=%s\nCOOKIE_SECURE=true\nFT_PORT=%s\nBACKUP_KEEP_DAYS=30\n' "$(openssl rand -hex 24)" "$PORT" > .env
  ok "создан .env со случайным паролем базы"
else
  grep -q '^FT_PORT=' .env && sed -i "s/^FT_PORT=.*/FT_PORT=$PORT/" .env || echo "FT_PORT=$PORT" >> .env
  grep -q '^COOKIE_SECURE=' .env && sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' .env || echo 'COOKIE_SECURE=true' >> .env
  ok ".env уже был — пароль базы не менял"
fi
mkdir -p data backups
if [ "${FT_NO_BUILD:-}" = 1 ]; then "${COMPOSE[@]}" up -d; else "${COMPOSE[@]}" up -d --build; fi
for i in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && die "FiberTrack не ответил за 2 минуты. Посмотрите журнал: ${COMPOSE[*]} logs backend"
  sleep 2
done
ok "FiberTrack отвечает на 127.0.0.1:$PORT"

say "5/6 Подключаю к nginx домен $DOMAIN"
if [ -d /etc/nginx/sites-enabled ]; then
  CONF=/etc/nginx/sites-available/fibertrack.conf; LINK=/etc/nginx/sites-enabled/fibertrack.conf
else
  CONF=/etc/nginx/conf.d/fibertrack.conf; LINK=""
fi
if [ -f "$CONF" ] && ! grep -qF "$MARK" "$CONF"; then
  die "$CONF уже существует и создан не этим скриптом. Ничего не трогаю."
fi
if grep -rqs "server_name[^;]*\b$DOMAIN\b" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null && ! grep -qs "server_name $DOMAIN;" "$CONF"; then
  die "Домен $DOMAIN уже описан в другом конфиге nginx. Выберите другой поддомен."
fi
HAD_CERT=0
# сертификат уже выпущен именно для этого домена — конфиг не переписываем; домен сменился — пишем заново
grep -qs 'ssl_certificate' "$CONF" && grep -qs "server_name $DOMAIN;" "$CONF" && HAD_CERT=1
LISTEN6=""
ss -tln | grep -q '\[::\]:80 ' && LISTEN6="    listen [::]:80;"
if [ "$HAD_CERT" = 0 ]; then
  cat > "$CONF" <<EOF
$MARK
server {
    listen 80;
$LISTEN6
    server_name $DOMAIN;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
  [ -n "$LINK" ] && ln -sf "$CONF" "$LINK"
fi
if ! nginx -t >/dev/null 2>&1; then
  [ "$HAD_CERT" = 0 ] && rm -f "$CONF" ${LINK:+"$LINK"}
  die "Новый конфиг не прошёл проверку nginx — я его удалил, ваш сайт не затронут. Вывод: $(nginx -t 2>&1 | tail -2)"
fi
systemctl reload nginx 2>/dev/null || nginx -s reload
ok "nginx перезагружен, ваш сайт работает как прежде"

say "6/6 HTTPS-сертификат"
if [ "${FT_SKIP_CERTBOT:-}" = 1 ]; then
  warn "пропущено (FT_SKIP_CERTBOT=1)"
elif [ "$HAD_CERT" = 1 ]; then
  ok "сертификат уже настроен"
else
  command -v certbot >/dev/null || { apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx; }
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
       $( [ -n "$EMAIL" ] && echo "-m $EMAIL" || echo "--register-unsafely-without-email" ); then
    ok "HTTPS включён"
  else
    warn "Сертификат получить не удалось. Чаще всего домен $DOMAIN ещё не указывает на этот сервер."
    warn "Добавьте у регистратора A-запись $DOMAIN → $(curl -fs4 https://ifconfig.me 2>/dev/null || echo 'IP сервера'), подождите 10–30 минут и выполните:"
    warn "  sudo certbot --nginx -d $DOMAIN --redirect"
    warn "До этого вход не будет работать: cookie передаются только по HTTPS."
  fi
fi

cat <<EOF

Готово. FiberTrack: https://$DOMAIN

Дальше (из папки $(pwd)):
  1) пользователи (пароль спросит):
     ${COMPOSE[*]} exec backend python -m app.cli create-user owner admin "Владелец"
     ${COMPOSE[*]} exec backend python -m app.cli create-user boss viewer "Руководитель"
     ${COMPOSE[*]} exec backend python -m app.cli create-user buh input "Бухгалтер"
  2) история: положите xlsx в $(pwd)/data, затем
     chmod 644 data/*.xlsx
     ${COMPOSE[*]} exec backend python -m app.cli import-history "/data/прибыль_по_машинам.xlsx" "/data/парк.xlsx"
EOF
