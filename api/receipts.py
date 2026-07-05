"""Роутер /receipts (Слой 6): загрузка фото чека + распознавание Gemini + отдача файла.

Файлы лежат на Railway Volume: {DATA_DIR}/receipts/{worker_id}/{yyyy-mm}/{id}.{ext}
Доступ к файлу: worker — только свои чеки; supervisor — чеки своей команды.
"""
import io
import json
import os
import pathlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

import db
import gemini
from config import DATA_DIR
from deps import require_auth, CurrentUser

router = APIRouter(prefix="/receipts", tags=["receipts"])

MAX_SIZE = 5 * 1024 * 1024  # 5 МБ
_EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
}
RECEIPTS_DIR = pathlib.Path(DATA_DIR) / "receipts"


def ensure_storage() -> None:
    """Создать корневую папку для чеков на старте (Volume смонтирован в DATA_DIR)."""
    RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)


def _own_worker_id(current: CurrentUser) -> int:
    if current.worker_id is None:
        raise HTTPException(status_code=400, detail="current user has no linked worker")
    return current.worker_id


def _clean_amount(value) -> float | None:
    """Привести сумму от Gemini к DECIMAL(8,2)-безопасному float или None."""
    try:
        amt = float(value)
    except (TypeError, ValueError):
        return None
    if not (0 <= amt < 1_000_000):
        return None
    return round(amt, 2)


@router.post("/upload")
async def upload_receipt(file: UploadFile = File(...), current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    mime = (file.content_type or "").lower()
    if mime not in _EXT_BY_MIME:
        raise HTTPException(status_code=400, detail="unsupported file type (jpeg/png/webp/heic only)")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="file too large (max 5 MB)")

    # Проверяем, что это реально изображение (heic Pillow без плагина не откроет — пропускаем).
    if mime != "image/heic":
        try:
            Image.open(io.BytesIO(data)).verify()
        except Exception:
            raise HTTPException(status_code=400, detail="file is not a valid image")

    # Распознавание Gemini (до записи, чтобы сохранить его вердикт).
    result = await gemini.recognize_receipt(data, mime)
    is_receipt = bool(result.get("is_receipt"))
    amount = _clean_amount(result.get("amount"))

    # Сохранение файла на Volume.
    receipt_id = uuid.uuid4()
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    target_dir = RECEIPTS_DIR / str(worker_id) / month
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{receipt_id}.{_EXT_BY_MIME[mime]}"
    path.write_bytes(data)

    await db.execute(
        "INSERT INTO receipts "
        "(id, worker_id, file_path, file_size_bytes, mime_type, recognized_amount, "
        " is_receipt_confirmed, gemini_raw_response) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
        receipt_id, worker_id, str(path), len(data), mime, amount, is_receipt, json.dumps(result),
    )

    return {
        "receipt_id": str(receipt_id),
        "is_receipt_confirmed": is_receipt,
        "recognized_amount": amount,
        "notes": result.get("notes", ""),
        "file_url": f"/receipts/{receipt_id}/file",
    }


async def _accessible_receipt(receipt_id: str, current: CurrentUser):
    """Вернуть строку чека, если пользователь имеет к нему доступ, иначе None."""
    row = await db.fetchrow(
        "SELECT r.id, r.file_path, r.mime_type, r.worker_id, r.recognized_amount, "
        "       r.confirmed_amount, r.created_at, w.user_id AS tenant "
        "FROM receipts r JOIN workers w ON w.id = r.worker_id WHERE r.id=$1::uuid",
        receipt_id,
    )
    if row is None:
        return None
    if current.role == "worker":
        return row if row["worker_id"] == current.worker_id else None
    return row if row["tenant"] == current.id else None  # supervisor — своя команда


@router.get("/{receipt_id}/file")
async def get_receipt_file(receipt_id: str, current: CurrentUser = Depends(require_auth)):
    row = await _accessible_receipt(receipt_id, current)
    if row is None:
        raise HTTPException(status_code=404, detail="receipt not found")
    path = pathlib.Path(row["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(str(path), media_type=row["mime_type"])


@router.get("/{receipt_id}")
async def get_receipt_meta(receipt_id: str, current: CurrentUser = Depends(require_auth)):
    row = await _accessible_receipt(receipt_id, current)
    if row is None:
        raise HTTPException(status_code=404, detail="receipt not found")
    return {
        "id": str(row["id"]),
        "worker_id": row["worker_id"],
        "recognized_amount": float(row["recognized_amount"]) if row["recognized_amount"] is not None else None,
        "confirmed_amount": float(row["confirmed_amount"]) if row["confirmed_amount"] is not None else None,
        "created_at": row["created_at"].isoformat(),
        "file_url": f"/receipts/{receipt_id}/file",
    }


@router.delete("/{receipt_id}")
async def delete_receipt(receipt_id: str, current: CurrentUser = Depends(require_auth)):
    """Удалить НЕ привязанный к выплате чек (rollback при «не чек»/отмене)."""
    worker_id = _own_worker_id(current)
    row = await db.fetchrow(
        "SELECT id, file_path FROM receipts WHERE id=$1::uuid AND worker_id=$2",
        receipt_id, worker_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="receipt not found")
    linked = await db.fetchval("SELECT 1 FROM weekly_payouts WHERE receipt_id=$1::uuid", receipt_id)
    if linked:
        raise HTTPException(status_code=400, detail="receipt is attached to a payout — delete the payout instead")
    await db.execute("DELETE FROM receipts WHERE id=$1::uuid", receipt_id)
    try:
        os.remove(row["file_path"])
    except OSError:
        pass  # файла уже нет — не критично
    return {"ok": True}
