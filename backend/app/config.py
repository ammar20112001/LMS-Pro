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
    student_name: str = _env.get("student_name", "")

    # Storage
    data_dir: Path = Path.home() / ".lms-pro"
    state_file: Path = Path.home() / ".lms-pro" / "state.json"
    files_dir: Path = Path.home() / ".lms-pro" / "files"

    # Email
    personal_email: str = _env.get("personal_email", "")
    notify_email: str = _env.get("notify_email", "")
    smtp_host: str = _env.get("smtp_host", "smtp.gmail.com")
    smtp_port: int = int(_env.get("smtp_port", "587"))
    smtp_user: str = _env.get("smtp_user", "")
    smtp_pass: str = _env.get("smtp_pass", "")
    smtp_from: str = _env.get("smtp_from", "")

    # Scheduler
    sync_interval_minutes: int = int(_env.get("sync_interval_minutes", "30"))
    digest_hour_local: int = int(_env.get("digest_hour_local", "7"))

    # AI — Phase 2
    ai_provider: str = _env.get("AI_PROVIDER", "gemini")
    gemini_api_key: str = _env.get("GEMINI_API_KEY", "")
    anthropic_api_key: str = _env.get("ANTHROPIC_API_KEY", "")
    obsidian_vault_path: str = _env.get("OBSIDIAN_VAULT_PATH", "")

    # Notes job
    notes_interval_minutes: int = int(_env.get("notes_interval_minutes", "3"))

    def __init__(self):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
