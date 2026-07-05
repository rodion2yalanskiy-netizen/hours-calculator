"""Роутер /push (Слой 7b): VAPID-ключ + подписки на web-push + тест."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

import db
import notifier
from config import VAPID_PUBLIC_KEY
from deps import require_auth, require_supervisor, CurrentUser

router = APIRouter(prefix="/push", tags=["push"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: PushKeys
    user_agent: str | None = None


class UnsubscribeBody(BaseModel):
    endpoint: str


def _own_worker_id(current: CurrentUser) -> int:
    if current.worker_id is None:
        raise HTTPException(status_code=400, detail="current user has no linked worker")
    return current.worker_id


@router.get("/vapid-public-key")
async def vapid_public_key(_current: CurrentUser = Depends(require_auth)):
    return {"public_key": VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def subscribe(body: SubscribeBody, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    row = await db.fetchrow(
        "INSERT INTO push_subscriptions (worker_id, endpoint, p256dh, auth, user_agent, last_used_at) "
        "VALUES ($1, $2, $3, $4, $5, now()) "
        "ON CONFLICT (endpoint) DO UPDATE SET "
        "  worker_id=EXCLUDED.worker_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, "
        "  user_agent=EXCLUDED.user_agent, last_used_at=now() "
        "RETURNING id",
        worker_id, body.endpoint, body.keys.p256dh, body.keys.auth, body.user_agent,
    )
    return {"subscription_id": str(row["id"])}


@router.post("/unsubscribe")
async def unsubscribe(body: UnsubscribeBody, current: CurrentUser = Depends(require_auth)):
    worker_id = _own_worker_id(current)
    await db.execute(
        "DELETE FROM push_subscriptions WHERE endpoint=$1 AND worker_id=$2",
        body.endpoint, worker_id,
    )
    return Response(status_code=204)


@router.post("/test")
async def test_push(current: CurrentUser = Depends(require_supervisor)):
    worker_id = _own_worker_id(current)
    subs = await db.fetch(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE worker_id=$1", worker_id
    )
    sent = 0
    failed = 0
    for s in subs:
        sub = {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
        try:
            ok = await notifier.send_push(sub, "Painter", "Тестовое уведомление ✓", url="/shifts")
            if ok:
                sent += 1
            else:
                failed += 1
        except notifier.SubscriptionExpired:
            await db.execute("DELETE FROM push_subscriptions WHERE id=$1", s["id"])
            failed += 1
        except Exception:  # noqa: BLE001
            failed += 1
    return {"sent": sent, "failed": failed}
