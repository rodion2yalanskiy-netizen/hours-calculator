"""Роутер /receipts (Слой 6, доработка 7f): загрузка фото чека + распознавание Gemini + отдача файла.

Файлы лежат на Railway Volume: {DATA_DIR}/receipts/{worker_id}/{yyyy-mm}/{id}.jpg
Доступ к файлу: worker — только свои чеки; supervisor — чеки своей команды.

7f: ИИ больше НЕ блокирует загрузку. Любое фото сохраняется всегда; если Gemini не
признал его чеком — review_status='pending_review' (supervisor проверит вручную).
Все изображения (в т.ч. HEIC с айфона) нормализуются в JPEG перед сохранением и отправкой в Gemini.
Supervisor может пометить чек недействительным через PATCH /receipts/{id}/review.
"""
import asyncio
import json
import os
import pathlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import db
import gemini
import notifier
from config import DATA_DIR
from deps import require_auth, CurrentUser

router = APIRouter(prefix="/receipts", tags=["receipts"])

MAX_SIZE = 5 * 1024 * 1024  # 5 МБ входного файла
# Что принимаем на вход (айфон шлёт heic; браузеры — jpeg/png/webp).
_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
_REVIEW_STATUSES = ("confirmed", "pending_review", "invalid")
RECEIPTS_DIR = pathlib.Path(DATA_DIR) / "receipts"


class ReviewPatch(BaseModel):
    review_status: str
    review_note: str | None = None


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
async def upload_receipt(
    request: Request,
    file: UploadFile = File(...),
    current: CurrentUser = Depends(require_auth),
):
    worker_id = _own_worker_id(current)
    mime = (file.content_type or "").lower()
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="unsupported file type (jpeg/png/webp/heic only)")

    # 7g: ранний отсев по Content-Length (аудит 🟡-2), чтобы не тянуть гигантское тело.
    clen = request.headers.get("content-length")
    if clen and clen.isdigit() and int(clen) > MAX_SIZE + 8192:  # +overhead multipart
        raise HTTPException(status_code=413, detail="Файл слишком большой (макс 5 МБ)")

    # Читаем чанками с обрывом при превышении — память ограничена ~MAX_SIZE, а не размером тела.
    data = b""
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        data += chunk
        if len(data) > MAX_SIZE:
            raise HTTPException(status_code=413, detail="Файл слишком большой (макс 5 МБ)")
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    # Нормализуем в JPEG (в т.ч. HEIC→JPEG, ужатие до 1600px). Это же и проверка,
    # что файл — реальное изображение: если не открылось, значит не картинка.
    try:
        jpeg = gemini.to_jpeg(data, mime)
    except Exception:
        raise HTTPException(status_code=400, detail="file is not a valid image")

    # Распознавание Gemini (по JPEG). ИИ НЕ блокирует: даже если ошибка/не чек —
    # сохраняем фото, просто помечаем pending_review для проверки supervisor'ом.
    result = await gemini.recognize_receipt(jpeg, "image/jpeg")
    is_receipt = bool(result.get("is_receipt"))
    amount = _clean_amount(result.get("amount"))
    review_status = "confirmed" if is_receipt else "pending_review"

    # Сохранение JPEG на Volume.
    receipt_id = uuid.uuid4()
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    target_dir = RECEIPTS_DIR / str(worker_id) / month
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{receipt_id}.jpg"
    path.write_bytes(jpeg)

    await db.execute(
        "INSERT INTO receipts "
        "(id, worker_id, file_path, file_size_bytes, mime_type, recognized_amount, "
        " is_receipt_confirmed, gemini_raw_response, review_status) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)",
        receipt_id, worker_id, str(path), len(jpeg), "image/jpeg", amount, is_receipt,
        json.dumps(result), review_status,
    )

    return {
        "receipt_id": str(receipt_id),
        "is_receipt_confirmed": is_receipt,
        "recognized_amount": amount,
        "review_status": review_status,
        "notes": result.get("notes", ""),
        "file_url": f"/receipts/{receipt_id}/file",
    }


async def _accessible_receipt(receipt_id: str, current: CurrentUser):
    """Вернуть строку чека, если пользователь имеет к нему доступ, иначе None."""
    row = await db.fetchrow(
        "SELECT r.id, r.file_path, r.mime_type, r.worker_id, r.recognized_amount, "
        "       r.confirmed_amount, r.created_at, r.review_status, r.review_note, "
        "       r.reviewed_at, w.user_id AS tenant "
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
        "review_status": row["review_status"],
        "review_note": row["review_note"],
        "reviewed_at": row["reviewed_at"].isoformat() if row["reviewed_at"] else None,
        "file_url": f"/receipts/{receipt_id}/file",
    }


@router.patch("/{receipt_id}/review")
async def review_receipt(receipt_id: str, body: ReviewPatch, current: CurrentUser = Depends(require_auth)):
    """Supervisor помечает чек: confirmed / pending_review / invalid (+ заметка).
    Только supervisor и только для чеков своей команды. При 'invalid' — push работнику."""
    if current.role != "supervisor":
        raise HTTPException(status_code=403, detail="only supervisor can review receipts")
    if body.review_status not in _REVIEW_STATUSES:
        raise HTTPException(status_code=400, detail="review_status must be confirmed/pending_review/invalid")

    row = await db.fetchrow(
        "SELECT r.id, r.worker_id, w.user_id AS tenant "
        "FROM receipts r JOIN workers w ON w.id = r.worker_id WHERE r.id=$1::uuid",
        receipt_id,
    )
    if row is None or row["tenant"] != current.id:
        raise HTTPException(status_code=404, detail="receipt not found")

    note = (body.review_note or "").strip() or None
    updated = await db.fetchrow(
        "UPDATE receipts SET review_status=$1, review_note=$2, reviewed_at=now(), reviewed_by=$3 "
        "WHERE id=$4::uuid "
        "RETURNING id, worker_id, review_status, review_note, reviewed_at",
        body.review_status, note, current.id, receipt_id,
    )

    # При 'invalid' — уведомить работника, что неделя не оплачена.
    if body.review_status == "invalid":
        payout = await db.fetchrow(
            "SELECT week_start FROM weekly_payouts WHERE receipt_id=$1::uuid", receipt_id
        )
        if payout is not None:
            week_txt = payout["week_start"].isoformat()
            body_txt = f"Чек за неделю {week_txt} отклонён супервайзером."
            if note:
                body_txt += f" Причина: {note}"
            asyncio.create_task(
                notifier.push_to_worker(row["worker_id"], "Чек отклонён", body_txt, "/payouts")
            )

    return {
        "id": str(updated["id"]),
        "worker_id": updated["worker_id"],
        "review_status": updated["review_status"],
        "review_note": updated["review_note"],
        "reviewed_at": updated["reviewed_at"].isoformat() if updated["reviewed_at"] else None,
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
