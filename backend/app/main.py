import hashlib
import re
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers import auth, data, input, periods, review, uploads, vehicles

app = FastAPI(title='FiberTrack', docs_url=None, redoc_url=None, openapi_url=None)
for r in (auth.router, data.router, vehicles.router, periods.router, input.router, review.router, uploads.router):
    app.include_router(r)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={'detail': 'Проверьте введённые данные: ' + '; '.join(
        f"{'.'.join(str(x) for x in e['loc'][1:])}" for e in exc.errors())})


@app.get('/api/health')
def health():
    return {'ok': True}


@app.middleware('http')
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('X-Frame-Options', 'DENY')
    resp.headers.setdefault('Referrer-Policy', 'same-origin')
    path = request.url.path
    if path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store'
    elif path in ('/', '/login') or path.startswith('/static/'):
        resp.headers['Cache-Control'] = 'no-cache'      # браузер каждый раз сверяется с сервером: после обновления сразу новая версия
    return resp


FRONT = Path(__file__).resolve().parent.parent / settings.frontend_dir
if FRONT.is_dir():
    app.mount('/static', StaticFiles(directory=FRONT), name='static')

    def page(name: str) -> HTMLResponse:
        """Страница со ссылками на app.js и app.css с отпечатком содержимого (?v=…): новая версия не застрянет в кэше."""
        html = (FRONT / name).read_text(encoding='utf-8')
        stamp = lambda m: f'{m.group(1)}?v={hashlib.sha1((FRONT / m.group(2)).read_bytes()).hexdigest()[:10]}'
        return HTMLResponse(re.sub(r'(/static/([\w./-]+\.(?:js|css)))', stamp, html))

    @app.get('/login')
    def login_page():
        return page('login.html')

    @app.get('/')
    def index():
        return page('index.html')
