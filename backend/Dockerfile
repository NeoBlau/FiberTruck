FROM postgres:16 AS postgres-tools
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Europe/Samara
WORKDIR /app/backend
COPY backend/requirements.txt /tmp/fibertruck-requirements.txt
RUN --mount=type=secret,id=proxy_ca \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi \
    && pip install --no-cache-dir -r /tmp/fibertruck-requirements.txt \
    && useradd -r -u 1001 ft \
    && mkdir -p /app/backend/uploads && chown -R ft:ft /app
# Keep recovery source alongside runtime code, in one layer. Production data are excluded.
COPY --chown=1001:1001 . /app/
COPY --from=postgres-tools /usr/lib/postgresql/16/bin/pg_dump /usr/local/bin/pg_dump
USER ft
EXPOSE 8000
# миграции при старте, затем сервер
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --workers 2"]
