from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки из переменных окружения (см. .env.example)."""
    model_config = SettingsConfigDict(env_prefix='FT_', env_file='.env', extra='ignore')

    database_url: str = 'postgresql+psycopg://fibertrack:fibertrack@localhost:5432/fibertrack'
    cookie_secure: bool = True              # на localhost без HTTPS выставить false
    session_days: int = 14
    login_max_failures: int = 5             # неудачных попыток …
    login_window_minutes: int = 15          # … за это окно → пауза на то же окно
    frontend_dir: str = '../frontend'
    timezone: str = 'Europe/Samara'


settings = Settings()
