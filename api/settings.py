"""Роутер /settings (Слой 7a): общие настройки приложения (singleton-строка).

Пока — только телефон босса (для будущей SMS-отправки в Слое 7b).
Читают все; меняет только supervisor.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import require_auth, require_supervisor, CurrentUser

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsPatch(BaseModel):
    boss_phone: str | None = None


def _normalize_phone(raw: str) -> str:
    """Привести телефон к E.164. US: 10 цифр → +1XXXXXXXXXX; 11 цифр с 1 → +1...;
    строка с ведущим + и 8–15 цифр — как есть. Иначе ValueError."""
    s = raw.strip()
    if not s:
        raise ValueError("empty")
    if s.startswith("+"):
        digits = re.sub(r"\D", "", s)
        if 8 <= len(digits) <= 15:
            return "+" + digits
        raise ValueError("bad E.164")
    digits = re.sub(r"\D", "", s)
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    raise ValueError("bad phone")


@router.get("")
async def get_settings(_current: CurrentUser = Depends(require_auth)):
    row = await db.fetchrow("SELECT boss_phone FROM app_settings WHERE id=1")
    return {"boss_phone": row["boss_phone"] if row else None}


@router.patch("")
async def patch_settings(body: SettingsPatch, current: CurrentUser = Depends(require_supervisor)):
    phone: str | None = None
    if body.boss_phone is not None and body.boss_phone.strip():
        try:
            phone = _normalize_phone(body.boss_phone)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid phone number")
    await db.execute(
        "UPDATE app_settings SET boss_phone=$1, updated_at=now(), updated_by=$2::uuid WHERE id=1",
        phone, current.user_id,
    )
    return {"boss_phone": phone}
