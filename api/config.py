"""Конфиг API — всё из окружения (секреты НЕ в коде). Родион заводит в Railway."""
import os

BOT_TOKEN = os.getenv("BOT_TOKEN", "")        # тот же токен бота — для проверки подписи initData
DATABASE_URL = os.getenv("DATABASE_URL", "")  # новый Postgres (не база CRM!)
OWNER_ID = int(os.getenv("OWNER_ID", "0"))    # numeric Telegram id владельца
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")   # домен Vercel; на этапе сборки "*", перед приёмкой сузить

# ── Слой 2: аутентификация (JWT + supervisor-сид) ────────────────────────────
# Родион задаёт эти переменные в Railway перед деплоем. Секреты НЕ в коде.
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "")                      # email supervisor'а (Родиона)
OWNER_INITIAL_PASSWORD = os.getenv("OWNER_INITIAL_PASSWORD", "")  # стартовый пароль → bcrypt-хэш при сиде
OWNER_FULL_NAME = os.getenv("OWNER_FULL_NAME", "")             # отображаемое имя supervisor'а
JWT_SECRET = os.getenv("JWT_SECRET", "")                       # секрет подписи JWT (openssl rand -hex 32)
