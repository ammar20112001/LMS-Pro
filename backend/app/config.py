from pathlib import Path
from dotenv import dotenv_values

_ENV_FILE = Path(__file__).parents[2] / ".env"
_env = dotenv_values(_ENV_FILE)  # reads .env only — ignores system env vars


class Settings:
    # LMS credentials — from .env only, never from system env vars
    lms_url: str = _env.get("lms_url", "https://vulms.vu.edu.pk/")
    username: str = _env.get("username", "")
    password: str = _env.get("password", "")
    roll_number: str = _env.get("roll_number", "")

    # Storage
    data_dir: Path = Path.home() / ".lms-pro"
    state_file: Path = Path.home() / ".lms-pro" / "state.json"

    # Email
    notify_email: str = _env.get("notify_email", "")
    smtp_host: str = _env.get("smtp_host", "smtp.gmail.com")
    smtp_port: int = int(_env.get("smtp_port", "587"))
    smtp_user: str = _env.get("smtp_user", "")
    smtp_pass: str = _env.get("smtp_pass", "")
    smtp_from: str = _env.get("smtp_from", "")

    # Scheduler
    sync_interval_minutes: int = int(_env.get("sync_interval_minutes", "30"))
    digest_hour_local: int = int(_env.get("digest_hour_local", "7"))

    def __init__(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
