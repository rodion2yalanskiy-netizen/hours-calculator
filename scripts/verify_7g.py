"""Live e2e для Слоя 7g (фиксы аудита) против прод-API. Самоочистка.

  OWNER_PASSWORD='...' python3 scripts/verify_7g.py

Проверяет: идемпотентность дублей смен, границы времени (422), потолок часов (400),
один чек = одна выплата (409), rate-limit логина (429), отсутствие задвоения стыковой недели.
"""
import os
import sys
import json
import io
import urllib.request
import urllib.error

API = os.getenv("API_URL", "https://api-production-0fe39.up.railway.app")
EMAIL = os.getenv("OWNER_EMAIL", "rodion2yalanskiy@axiom-void.com")
PASSWORD = os.getenv("OWNER_PASSWORD", "")

results = []


def req(method, path, token=None, body=None, raw=None, ctype=None):
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
        headers["Content-Type"] = ctype
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=40) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt}


def check(name, cond, detail=""):
    results.append(cond)
    print(f"{'✅' if cond else '❌'} {name}" + (f" — {detail}" if detail else ""))


def multipart_jpeg():
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (400, 300), (200, 200, 200)).save(buf, format="JPEG")
        content = buf.getvalue()
    except Exception:
        content = bytes.fromhex("ffd8ffe000104a464946000101000001000100" "00" "ffd9")
    boundary = "----7gb"
    b = io.BytesIO()
    b.write(f"--{boundary}\r\n".encode())
    b.write(b'Content-Disposition: form-data; name="file"; filename="t.jpg"\r\n')
    b.write(b"Content-Type: image/jpeg\r\n\r\n")
    b.write(content)
    b.write(f"\r\n--{boundary}--\r\n".encode())
    return b.getvalue(), f"multipart/form-data; boundary={boundary}"


def main():
    if not PASSWORD:
        print("!! Задай OWNER_PASSWORD", file=sys.stderr)
        sys.exit(2)
    st, login = req("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    if st != 200 or not login.get("token"):
        print(f"!! Логин не прошёл ({st}): {login}", file=sys.stderr)
        sys.exit(2)
    tok = login["token"]
    wid = login["user"].get("worker_id") or 1
    print(f"→ supervisor вошёл\n")

    created_shifts, created_payouts, created_receipts = [], [], []
    BODY = {"worker_id": wid, "date": "2026-12-30", "object_name": "7g-dedup-test",
            "start_min": 480, "end_min": 930, "has_lunch": False}

    # 2) Границы времени → 422
    st, _ = req("POST", "/shifts", token=tok, body={**BODY, "start_min": 9999})
    check("2. start_min=9999 → 422", st == 422, f"status={st}")

    # 3) Потолок часов: 08:00–06:00 (через сутки, ~22ч) → 400
    st, r = req("POST", "/shifts", token=tok, body={**BODY, "start_min": 480, "end_min": 360})
    check("3. смена ~22ч → 400 (потолок)", st == 400, f"status={st}")
    if st in (200, 201):
        created_shifts.append(r["id"])

    # 1) Дубли: два одинаковых POST → одна смена (идемпотентно, тот же id)
    st1, s1 = req("POST", "/shifts", token=tok, body=BODY)
    st2, s2 = req("POST", "/shifts", token=tok, body=BODY)
    if st1 in (200, 201):
        created_shifts.append(s1["id"])
    same = st1 in (200, 201) and st2 in (200, 201, 409) and (s2.get("id") == s1.get("id") or st2 == 409)
    check("1. двойной POST не создаёт дубль", same, f"id1={s1.get('id')} st2={st2} id2={s2.get('id')}")
    # подтверждаем в БД — ровно одна смена на эту дату/объект
    st, shifts = req("GET", f"/shifts?year=2026&month=12&worker_id={wid}", token=tok)
    dups = [s for s in shifts if s["object_name"] == "7g-dedup-test"] if st == 200 else []
    check("1b. в БД ровно одна такая смена", len(dups) == 1, f"найдено {len(dups)}")

    # 4) Один чек → две выплаты (разные недели) → вторая 409
    raw, ct = multipart_jpeg()
    st, up = req("POST", "/receipts/upload", token=tok, raw=raw, ctype=ct)
    if st == 200:
        rid = up["receipt_id"]
        created_receipts.append(rid)
        st_a, pa = req("POST", "/payouts/from-receipt", token=tok, body={
            "receipt_id": rid, "week_start": "2026-11-30", "week_end": "2026-12-06",
            "confirmed_amount": 50, "shortfall_reason": "debt"})
        if st_a in (200, 201):
            created_payouts.append(pa["id"])
        st_b, pb = req("POST", "/payouts/from-receipt", token=tok, body={
            "receipt_id": rid, "week_start": "2026-12-07", "week_end": "2026-12-13",
            "confirmed_amount": 50, "shortfall_reason": "debt"})
        check("4. один чек → вторая выплата 409", st_b == 409, f"1я={st_a} 2я={st_b} {pb.get('detail','')}")
        if st_b in (200, 201):
            created_payouts.append(pb["id"])
    else:
        check("4. upload чека для теста", False, f"upload status={st}")

    # 6) Стыковая неделя: неделя 29 июня не задвоена июнь/июль
    st_j, jun = req("GET", "/summary/period?from=2026-06-01&to=2026-06-30&worker_id=" + str(wid), token=tok)
    st_l, jul = req("GET", "/summary/period?from=2026-07-01&to=2026-07-31&worker_id=" + str(wid), token=tok)
    if st_j == 200 and st_l == 200:
        jun_weeks = {w["week_start"] for w in jun["workers"][0]["weeks"]} if jun["workers"] else set()
        jul_weeks = {w["week_start"] for w in jul["workers"][0]["weeks"]} if jul["workers"] else set()
        overlap = jun_weeks & jul_weeks
        check("6. стыковая неделя не в обоих месяцах", not overlap, f"overlap={overlap}")
    else:
        check("6. summary/period", False, f"jun={st_j} jul={st_l}")

    # 5) Rate-limit логина: 12 неверных попыток → где-то появится 429
    got429 = False
    for i in range(12):
        st, _ = req("POST", "/auth/login", body={"email": "bogus-7g@nowhere.zzz", "password": "x"})
        if st == 429:
            got429 = True
            break
    check("5. rate-limit логина → 429", got429, "429 после серии попыток" if got429 else "429 не сработал")

    # ── Очистка ──
    print("\n→ очистка…")
    for pid in created_payouts:
        req("DELETE", f"/payouts/{pid}", token=tok)
    for rid in created_receipts:
        req("DELETE", f"/receipts/{rid}", token=tok)
    for sid in set(created_shifts):
        req("DELETE", f"/shifts/{sid}", token=tok)

    npass = sum(1 for r in results if r)
    print(f"\nИтог: {npass}/{len(results)} проверок пройдено.")
    sys.exit(0 if npass == len(results) else 1)


if __name__ == "__main__":
    main()
