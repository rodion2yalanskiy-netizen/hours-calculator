"""Распознавание чеков через Gemini Vision (Слой 6, доработка 7f).

7f: HEIC/HEIF с айфона конвертируем в JPEG перед отправкой (Gemini не принимает HEIC);
реальные ошибки логируем (logging.error), а не проглатываем; промпт смягчён под реальные
банковские чеки/выписки.
"""
import asyncio
import io
import json
import logging

import google.generativeai as genai
from PIL import Image

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()  # даёт PIL открывать HEIC/HEIF
    _HEIF_OK = True
except Exception:  # noqa: BLE001 — если плагин не встал, HEIC не поддержим, но не падаем
    _HEIF_OK = False

from config import GEMINI_API_KEY

logger = logging.getLogger("gemini")

_MODEL = None
_MODEL_NAME = "gemini-2.0-flash"
_MAX_SIDE = 1600  # ужимаем большие фото для скорости/токенов

PROMPT = """
Ты — помощник для распознавания чеков и подтверждений оплаты строительной бригады маляров.
На фото — документ, подтверждающий выплату денег работнику.

Ответь СТРОГО в формате JSON без markdown-обёртки:
{
  "is_receipt": true | false,
  "amount": <число или null>,
  "currency": "USD" | "CAD" | null,
  "notes": "<короткое объяснение что видишь>"
}

is_receipt=true, если это ЛЮБОЕ из:
- бумажный чек любого банка (US Bank, Bank of America, Chase, Wells Fargo, PNC и др.)
- банковская выписка или квитанция о депозите / ATM deposit receipt / deposit summary
- рукописный чек (payroll check, personal check), расписка о выплате
- скриншот перевода: Venmo, CashApp, Zelle, Apple Pay, e-transfer / Interac, PayPal
- фото под углом, с бликами, тенями, частично обрезанное — ВСЁ РАВНО валидно, если виден смысл платежа

is_receipt=false ТОЛЬКО если это явно постороннее: человек, животное, еда, пейзаж,
интерьер, случайный предмет, скриншот не про деньги.

Правила по сумме:
- amount — итоговая выплаченная работнику сумма (не подытог товаров). Если сумм несколько — финальная/итоговая.
- amount=null, если не смог уверенно определить сумму.
- notes — 1-2 предложения на русском, что видишь.
"""


def _get_model():
    global _MODEL
    if _MODEL is None:
        genai.configure(api_key=GEMINI_API_KEY)
        _MODEL = genai.GenerativeModel(_MODEL_NAME)
    return _MODEL


def to_jpeg(image_bytes: bytes, mime_type: str) -> bytes:
    """Любое изображение (в т.ч. HEIC/HEIF с айфона) → JPEG-байты, ужатые до _MAX_SIDE.
    Бросает исключение, если это не изображение."""
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > _MAX_SIDE:
        img.thumbnail((_MAX_SIDE, _MAX_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88, optimize=True)
    return out.getvalue()


def _recognize_sync(jpeg_bytes: bytes) -> dict:
    response = _get_model().generate_content([
        PROMPT,
        {"mime_type": "image/jpeg", "data": jpeg_bytes},
    ])
    raw_text = (response.text or "").strip()
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


async def recognize_receipt(jpeg_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """Распознать чек (принимает УЖЕ JPEG-байты). При любой ошибке — is_receipt=False,
    но реальная причина логируется (logging.error), а не проглатывается молча."""
    try:
        return await asyncio.to_thread(_recognize_sync, jpeg_bytes)
    except Exception as e:  # noqa: BLE001
        logger.error("Gemini recognize failed: %s", e, exc_info=True)
        return {
            "is_receipt": False,
            "amount": None,
            "currency": None,
            "notes": f"Не удалось распознать автоматически: {e}",
            "raw_text": str(e),
        }
