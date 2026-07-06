"""Конфиг API — всё из окружения (секреты НЕ в коде). Родион заводит в Railway."""
import os

BOT_TOKEN = os.getenv("BOT_TOKEN", "")        # тот же токен бота — для проверки подписи initData
DATABASE_URL = os.getenv("DATABASE_URL", "")  # новый Postgres (не база CRM!)
OWNER_ID = int(os.getenv("OWNER_ID", "0"))    # numeric Telegram id владельца
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")   # домен Vercel; на этапе сборки "*", перед приёмкой сузить
ENABLE_DOCS = os.getenv("ENABLE_DOCS", "false").lower() == "true"  # /docs, /redoc, /openapi.json — выкл. по умолчанию (публично не светим структуру API)

# ── Слой 2: аутентификация (JWT + supervisor-сид) ────────────────────────────
# Родион задаёт эти переменные в Railway перед деплоем. Секреты НЕ в коде.
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "")                      # email supervisor'а (Родиона)
OWNER_INITIAL_PASSWORD = os.getenv("OWNER_INITIAL_PASSWORD", "")  # стартовый пароль → bcrypt-хэш при сиде
OWNER_FULL_NAME = os.getenv("OWNER_FULL_NAME", "")             # отображаемое имя supervisor'а
JWT_SECRET = os.getenv("JWT_SECRET", "")                       # секрет подписи JWT (openssl rand -hex 32)

# ── Слой 6: фото-чеки (Gemini Vision + Railway Volume) ───────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")   # ключ Gemini Vision (распознавание чеков)
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")  # 7g: модель в env (сменить без редеплоя при бане/квоте)
DATA_DIR = os.getenv("DATA_DIR", "/data")          # смонтированный Railway Volume для файлов чеков

# ── Слой 7b: web push (VAPID) + субботние напоминания ────────────────────────
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")    # публичный ключ (браузер, applicationServerKey)
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")  # приватный ключ (сервер, pywebpush)
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:rodion2yalanskiy@axiom-void.com")
SUBSCRIBER_TIMEZONE = os.getenv("SUBSCRIBER_TIMEZONE", "America/Los_Angeles")  # локальное время работников
