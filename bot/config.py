"""Конфиг бота — всё из окружения (секреты НЕ в коде). Родион заводит в Railway."""
import os

BOT_TOKEN = os.getenv("BOT_TOKEN", "")          # токен бота (тот же, что в api для проверки подписи)
MINIAPP_URL = os.getenv("MINIAPP_URL", "")      # URL фронта на Vercel (для кнопки web_app)
OWNER_ID = int(os.getenv("OWNER_ID", "0"))      # 0 = /start доступен всем; иначе — только владельцу
