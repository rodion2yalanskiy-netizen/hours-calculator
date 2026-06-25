"""Конфиг API — всё из окружения (секреты НЕ в коде). Родион заводит в Railway."""
import os

BOT_TOKEN = os.getenv("BOT_TOKEN", "")        # тот же токен бота — для проверки подписи initData
DATABASE_URL = os.getenv("DATABASE_URL", "")  # новый Postgres (не база CRM!)
OWNER_ID = int(os.getenv("OWNER_ID", "0"))    # numeric Telegram id владельца
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "*")   # домен Vercel; на этапе сборки "*", перед приёмкой сузить
