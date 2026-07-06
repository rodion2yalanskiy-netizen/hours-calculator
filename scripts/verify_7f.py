"""Live e2e для Слоя 7f против прод-API. Запуск:

  OWNER_PASSWORD='...' python3 scripts/verify_7f.py
  # опционально: WORKER_EMAIL=... WORKER_PASSWORD=... для проверок worker-флоу

Проверяет чек-лист 7f. Чистит за собой всё созданное.
"""
import io
import os
import sys
import json
import urllib.request
import urllib.error

API = os.getenv("API_URL", "https://api-production-0fe39.up.railway.app")
OWNER_EMAIL = os.getenv("OWNER_EMAIL", "rodion2yalanskiy@axiom-void.com")
OWNER_PASSWORD = os.getenv("OWNER_PASSWORD", "")
WORKER_EMAIL = os.getenv("WORKER_EMAIL", "")
WORKER_PASSWORD = os.getenv("WORKER_PASSWORD", "")

PASS, FAIL = "✅", "❌"
results = []


def req(method, path, token=None, body=None, raw=None, content_type=None):
    url = API + path
    headers = {}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif raw is not None:
        data = raw
        if content_type:
            headers["Content-Type"] = content_type
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt}


def multipart(field, filename, content, mime):
    boundary = "----7fverifyboundary"
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode())
    body.write(f"Content-Type: {mime}\r\n\r\n".encode())
    body.write(content)
    body.write(f"\r\n--{boundary}--\r\n".encode())
    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


def check(name, cond, detail=""):
    results.append((cond, name, detail))
    print(f"{PASS if cond else FAIL} {name}" + (f" — {detail}" if detail else ""))


def make_heic_or_jpeg():
    """Вернуть (bytes, filename, mime). Пытаемся HEIC (айфон), иначе JPEG."""
    try:
        from PIL import Image
        import pillow_heif  # noqa
        buf = io.BytesIO()
        heif = pillow_heif.from_pillow(Image.new("RGB", (1200, 900), (40, 70, 100)))
        heif.save(buf, format="HEIF")
        return buf.getvalue(), "test.heic", "image/heic"
    except Exception:
        try:
            from PIL import Image
            buf = io.BytesIO()
            Image.new("RGB", (1200, 900), (40, 70, 100)).save(buf, format="JPEG")
            return buf.getvalue(), "test.jpg", "image/jpeg"
        except Exception:
            # 1x1 JPEG заглушка
            return (bytes.fromhex(
                "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
                "07090908"), "tiny.jpg", "image/jpeg")


def main():
    if not OWNER_PASSWORD:
        print("!! Задай OWNER_PASSWORD", file=sys.stderr)
        sys.exit(2)

    st, login = req("POST", "/auth/login", body={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    if st != 200 or not login.get("token"):
        print(f"!! Логин supervisor не прошёл ({st}): {login}", file=sys.stderr)
        sys.exit(2)
    sup = login["token"]
    print(f"→ supervisor вошёл ({OWNER_EMAIL})\n")

    created_receipts, created_payouts, created_shifts = [], [], []

    # 1) Загрузка HEIC/фото → 200, файл сохранён (даже при Gemini 429 — pending_review).
    content, fname, mime = make_heic_or_jpeg()
    raw, ct = multipart("file", fname, content, mime)
    st, up = req("POST", "/receipts/upload", token=sup, raw=raw, content_type=ct)
    check("1. Загрузка чека (HEIC/JPEG) → 200", st == 200, f"status={st}, review_status={up.get('review_status')}")
    if st == 200:
        created_receipts.append(up["receipt_id"])
        check("1b. review_status присутствует", up.get("review_status") in ("confirmed", "pending_review"),
              str(up.get("review_status")))

    # 3) from-receipt без receipt_id → 4xx (обяз. поле).
    st, _ = req("POST", "/payouts/from-receipt", token=sup,
                body={"week_start": "2026-06-01", "week_end": "2026-06-07", "confirmed_amount": 100})
    check("3. from-receipt без receipt_id → 400/422", st in (400, 422), f"status={st}")

    # 2)+5) Создать выплату по чеку → пометить invalid → проверить review_status в payout.
    rid = created_receipts[0] if created_receipts else None
    if rid:
        st, pay = req("POST", "/payouts/from-receipt", token=sup, body={
            "receipt_id": rid, "week_start": "2026-06-01", "week_end": "2026-06-07",
            "confirmed_amount": 100.0, "shortfall_reason": "debt",
        })
        ok2 = st in (200, 201)
        check("2. Выплата по чеку создаётся (ИИ не блокирует)", ok2, f"status={st} {('' if ok2 else pay)}")
        if ok2:
            created_payouts.append(pay["id"])
            # review invalid
            st, rev = req("PATCH", f"/receipts/{rid}/review", token=sup,
                          body={"review_status": "invalid", "review_note": "тест 7f"})
            check("5. Supervisor помечает чек invalid → 200", st == 200, f"status={st}")
            # payout теперь отражает invalid
            st, plist = req("GET", "/payouts?worker_id=" + str(pay["worker_id"]), token=sup)
            mine = next((x for x in plist if x["id"] == pay["id"]), None) if st == 200 else None
            check("5b. Payout содержит review_status=invalid + note",
                  bool(mine) and mine.get("review_status") == "invalid" and mine.get("review_note") == "тест 7f",
                  str(mine.get("review_status") if mine else None))

    # 4) review работником → 403 (если есть worker-креды).
    if WORKER_EMAIL and WORKER_PASSWORD and rid:
        st, wl = req("POST", "/auth/login", body={"email": WORKER_EMAIL, "password": WORKER_PASSWORD})
        if st == 200 and wl.get("token"):
            wtok = wl["token"]
            st, _ = req("PATCH", f"/receipts/{rid}/review", token=wtok, body={"review_status": "confirmed"})
            check("4. review работником → 403", st == 403, f"status={st}")
            # 6) worker создаёт смену (проверяем 200; push проверяется на телефоне supervisor'а)
            st, sh = req("POST", "/shifts", token=wtok, body={
                "worker_id": wl["worker_id"], "date": "2026-06-10", "object_name": "7f-test",
                "start_min": 8 * 60, "end_min": 16 * 60, "has_lunch": False,
            })
            check("6. worker создаёт смену → 200 (push supervisor'у — см. телефон)", st == 200, f"status={st}")
            if st == 200:
                created_shifts.append((wtok, sh["id"]))
            # 7) worker меняет свою ставку → 200, snapshot прошлой смены НЕ меняется
            if st == 200:
                snap_before = sh["hourly_rate"]
                st, me = req("PATCH", "/auth/me", token=wtok, body={"hourly_rate": snap_before + 7})
                check("7. worker меняет свою ставку → 200 (push supervisor'у)", st == 200, f"status={st}")
                st, shifts = req("GET", f"/shifts?worker_id={wl['worker_id']}", token=wtok)
                same = next((x for x in shifts if x["id"] == sh["id"]), None) if st == 200 else None
                check("7b. snapshot прошлой смены НЕ пересчитан (Вариант A)",
                      bool(same) and abs(float(same["hourly_rate"]) - float(snap_before)) < 0.001,
                      f"было {snap_before}, стало {same['hourly_rate'] if same else '?'}")
                # вернуть ставку назад
                req("PATCH", "/auth/me", token=wtok, body={"hourly_rate": snap_before})
        else:
            print(f"(worker-логин не прошёл — пропускаю пункты 4/6/7: {st})")
    else:
        print("(нет WORKER_EMAIL/WORKER_PASSWORD — пункты 4/6/7 пропущены)")

    # 8) supervisor меняет свою ставку → 200, себе push НЕ шлётся (проверяется на телефоне — без ошибок)
    st, me = req("GET", "/auth/me", token=sup)
    if st == 200:
        r0 = float(me["hourly_rate"])
        st, _ = req("PATCH", "/auth/me", token=sup, body={"hourly_rate": r0})  # без изменения
        check("8. supervisor PATCH своей ставки → 200 (без self-push)", st == 200, f"status={st}")

    # ── Очистка ──
    print("\n→ очистка тестовых данных…")
    for pid in created_payouts:
        req("DELETE", f"/payouts/{pid}", token=sup)  # удалит и чек
    for rid in created_receipts:
        req("DELETE", f"/receipts/{rid}", token=sup)
    for wtok, sid in created_shifts:
        req("DELETE", f"/shifts/{sid}", token=wtok)

    npass = sum(1 for ok, _, _ in results if ok)
    print(f"\nИтог: {npass}/{len(results)} проверок пройдено.")
    sys.exit(0 if npass == len(results) else 1)


if __name__ == "__main__":
    main()
