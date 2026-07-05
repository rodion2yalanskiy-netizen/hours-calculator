"""Отправка web-push через pywebpush (Слой 7b).

send_push — async-обёртка (webpush синхронный → threadpool). Возвращает True/False;
на мёртвой подписке (410 Gone / 404) бросает SubscriptionExpired — вызывающий удаляет её.
"""
import asyncio
import json

from pywebpush import webpush, WebPushException

import db
from config import VAPID_PRIVATE_KEY, VAPID_SUBJECT


class SubscriptionExpired(Exception):
    """Подписка мертва (endpoint 410/404) — удалить из БД."""


def _send_sync(subscription: dict, title: str, body: str, url: str) -> bool:
    if not VAPID_PRIVATE_KEY:
        return False  # ключи ещё не заданы в Railway — тихо пропускаем
    payload = json.dumps({"title": title, "body": body, "url": url})
    try:
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
            timeout=10,
        )
        return True
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            raise SubscriptionExpired()
        return False


async def send_push(subscription: dict, title: str, body: str, url: str = "/shifts") -> bool:
    return await asyncio.to_thread(_send_sync, subscription, title, body, url)


async def push_to_worker(worker_id: int, title: str, body: str, url: str = "/shifts") -> int:
    """Отправить push всем подпискам работника; мёртвые (410/404) удалить.
    Возвращает число успешно отправленных. Тихо переживает любые сбои."""
    subs = await db.fetch(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE worker_id=$1", worker_id
    )
    sent = 0
    for s in subs:
        sub = {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
        try:
            if await send_push(sub, title, body, url=url):
                sent += 1
        except SubscriptionExpired:
            await db.execute("DELETE FROM push_subscriptions WHERE id=$1", s["id"])
        except Exception:  # noqa: BLE001
            pass
    return sent
