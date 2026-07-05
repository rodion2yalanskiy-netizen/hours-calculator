"""Распознавание чеков через Gemini Vision (Слой 6).

Модель инициализируется лениво (при первом вызове) — импорт модуля не требует
ключа/сети. Синхронный generate_content выполняется в threadpool, чтобы не
блокировать event loop FastAPI.
"""
import asyncio
import json

import google.generativeai as genai

from config import GEMINI_API_KEY

_MODEL = None
_MODEL_NAME = "gemini-2.0-flash"

PROMPT = """
Ты — помощник для распознавания чеков строительной бригады маляров.
На фотографии должен быть чек, receipt, банковская распечатка или подобный документ подтверждающий выплату денег.

Ответь СТРОГО в формате JSON без markdown-обёртки:
{
  "is_receipt": true | false,
  "amount": <число или null>,
  "currency": "USD" | "CAD" | null,
  "notes": "<короткое объяснение что видишь>"
}

Правила:
- is_receipt=true ТОЛЬКО если это действительно чек, receipt, банковская выписка, скриншот перевода (Venmo, CashApp, Zelle, e-transfer, etransfer), рукописная расписка о выплате
- is_receipt=false если это случайное фото (человек, машина, животное, еда, интерьер)
- amount — итоговая сумма выплаты работнику (не сумма товаров в магазине!). Если чек показывает несколько сумм — выбери финальную/итоговую
- amount=null если не смог определить сумму или это не чек
- notes — 1-2 предложения на русском, что видишь
"""


def _get_model():
    global _MODEL
    if _MODEL is None:
        genai.configure(api_key=GEMINI_API_KEY)
        _MODEL = genai.GenerativeModel(_MODEL_NAME)
    return _MODEL


def _recognize_sync(image_bytes: bytes, mime_type: str) -> dict:
    response = _get_model().generate_content([
        PROMPT,
        {"mime_type": mime_type, "data": image_bytes},
    ])
    raw_text = (response.text or "").strip()
    # Убираем возможные ```json ... ``` обёртки.
    if raw_text.startswith("```"):
        parts = raw_text.split("```")
        raw_text = parts[1] if len(parts) > 1 else raw_text
        if raw_text.startswith("json"):
            raw_text = raw_text[4:]
        raw_text = raw_text.strip()
    parsed = json.loads(raw_text)
    return {
        "is_receipt": bool(parsed.get("is_receipt", False)),
        "amount": parsed.get("amount"),
        "currency": parsed.get("currency"),
        "notes": parsed.get("notes", ""),
        "raw_text": raw_text,
    }


async def recognize_receipt(image_bytes: bytes, mime_type: str) -> dict:
    """Отправить фото в Gemini и вернуть {is_receipt, amount, currency, notes, raw_text}.
    При любой ошибке — is_receipt=False (фронт покажет «не чек»)."""
    try:
        return await asyncio.to_thread(_recognize_sync, image_bytes, mime_type)
    except Exception as e:  # noqa: BLE001 — любая ошибка сети/парсинга → мягкий отказ
        return {
            "is_receipt": False,
            "amount": None,
            "currency": None,
            "notes": f"Ошибка распознавания: {e}",
            "raw_text": str(e),
        }
