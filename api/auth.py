"""Проверка подписи Telegram initData + owner-only.

Подпись НЕ проверяем руками — используем готовую функцию aiogram
`safe_parse_webapp_init_data`. Внутри корректный HMAC по офиц. доке Telegram:
    secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
    hash       = HMAC_SHA256(key=secret_key,  msg=data_check_string)
(ключ — строка "WebAppData", сообщение — токен; НЕ наоборот.)
Невалидная подпись → 401. Чужой Telegram id → 403 (доступ только владельцу).
"""
from fastapi import Header, HTTPException
from aiogram.utils.web_app import safe_parse_webapp_init_data
from config import BOT_TOKEN, OWNER_ID


async def require_owner(x_telegram_init_data: str = Header(default="")):
    """FastAPI-зависимость: валидирует подпись и сверяет владельца. Вернёт user."""
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="missing init data")
    try:
        data = safe_parse_webapp_init_data(BOT_TOKEN, x_telegram_init_data)
    except Exception:
        # неверная подпись / просроченные/битые данные
        raise HTTPException(status_code=401, detail="invalid init data signature")

    user = data.user
    if user is None or user.id != OWNER_ID:
        raise HTTPException(status_code=403, detail="forbidden: owner only")
    return user
