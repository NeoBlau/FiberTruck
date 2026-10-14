from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers import auth, data, input, periods, review, vehicles

app = FastAPI(title='FiberTrack', docs_url=None, redoc_url=None, openapi_url=None)
for r in (auth.router, data.router, vehicles.router, periods.router, input.router, review.router):
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
    if request.url.path.startswith('/api/'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp


FRONT = Path(__file__).resolve().parent.parent / settings.frontend_dir
if FRONT.is_dir():
    app.mount('/static', StaticFiles(directory=FRONT), name='static')

    @app.get('/login')
    def login_page():
        return FileResponse(FRONT / 'login.html')

    @app.get('/')
    def index():
        return FileResponse(FRONT / 'index.html')
