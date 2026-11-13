"""Owner-only downloadable recovery archive; dump credentials never enter the archive."""
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.engine import make_url
from starlette.background import BackgroundTask

from ..config import settings
from ..models import User
from ..security import require_roles

router = APIRouter(prefix='/api', tags=['backups'])

RESTORE = """FiberTruck — восстановление
Архив содержит database.sql (вся база, пользователи, настройки, журнал и история),
uploads/ (оригиналы Excel), project/ (код программы), manifest.json (контрольные суммы).
Архив содержит конфиденциальные данные, храните его в защищённом месте.
Пароли подключения к базе, TLS-сертификаты и конфигурация хоста не включены.
Сохраните рабочий .env отдельно; образец есть в project/.env.example.

1. Распакуйте архив в отдельную папку; проверьте SHA-256 из manifest.json.
2. Разверните project/ с вашим .env на PostgreSQL 16 или новее.
3. Остановите backend, оставив db запущенной. Восстанавливайте в ПУСТУЮ базу:
   docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < database.sql
4. Скопируйте uploads/ в том загрузок backend (обычно /app/backend/uploads).
   Путь на исходной установке указан в manifest.json: upload_directory.
   Если путь меняется, обновите uploads.path в базе на новый путь к тем же именам файлов.
5. Запустите backend, проверьте вход, месяцы, показатели и историю загрузок.
Для установки за nginx добавляйте -f docker-compose.yml -f deploy/docker-compose.behind-proxy.yml.
Не восстанавливайте поверх рабочей базы. Перед заменой сохраните её резервную копию.
"""


@router.get('/backup')
def download_backup(user: User = Depends(require_roles('admin'))):
    folder = Path(tempfile.mkdtemp(prefix='fibertruck-backup-'))
    try:
        url = make_url(settings.database_url)
        if url.get_backend_name() != 'postgresql':
            raise HTTPException(503, 'Полное резервное копирование требует PostgreSQL.')
        env = {**os.environ, 'PGPASSWORD': url.password or ''}
        command = ['pg_dump', '--no-owner', '--no-acl', '--format=plain', '--file', str(folder / 'database.sql'),
                   '--host', url.host or 'localhost', '--port', str(url.port or 5432),
                   '--username', url.username or '', '--dbname', url.database or '']
        for key, value in url.query.items():
            if key in ('sslmode', 'sslrootcert', 'sslcert', 'sslkey'):
                env['PG' + key.upper()] = value
        subprocess.run(command, env=env, check=True, capture_output=True, timeout=300)
        archive = folder / 'backup.zip'
        checksums = {}
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            def add(path, name):
                # Skip links: archive only actual application files.
                if path.is_file() and not path.is_symlink():
                    z.write(path, name)
                    digest = hashlib.sha256()
                    with path.open('rb') as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                            digest.update(chunk)
                    checksums[name] = digest.hexdigest()
            add(folder / 'database.sql', 'database.sql')
            uploads = Path(settings.upload_dir)
            if uploads.exists():
                for path in sorted(uploads.rglob('*')):
                    add(path, 'uploads/' + path.relative_to(uploads).as_posix())
            project = Path(__file__).resolve().parents[3]
            recovery = project / 'restore-project'
            source = recovery if recovery.is_dir() else project
            for root in ('backend', 'frontend', 'deploy'):
                for path in sorted((source / root).rglob('*')):
                    rel = path.relative_to(source)
                    if not any(x in rel.parts for x in ('uploads', '__pycache__', '.venv', 'shots')) and path.name != '.env':
                        add(path, 'project/' + rel.as_posix())
            for name in ('docker-compose.yml', '.env.example', 'README.md'):
                add(source / name, 'project/' + name)
            z.writestr('RESTORE.txt', RESTORE)
            z.writestr('manifest.json', json.dumps({'format': 1, 'application': 'FiberTruck',
                'created_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                'upload_directory': str(uploads.resolve()), 'sha256': checksums}, ensure_ascii=False, indent=2))
        return FileResponse(archive, media_type='application/zip',
                            filename=f'FiberTruck_backup_{dt.datetime.now(dt.timezone.utc):%Y-%m-%d_%H-%M-%S}.zip',
                            headers={'Cache-Control': 'no-store'},
                            background=BackgroundTask(shutil.rmtree, folder, ignore_errors=True))
    except HTTPException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    except (OSError, subprocess.SubprocessError):
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(503, 'Не удалось создать полный архив. Проверьте доступ к PostgreSQL и наличие pg_dump на сервере.') from None
