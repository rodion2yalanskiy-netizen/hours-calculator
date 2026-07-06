"""Live e2e для Слоя 8 (гибкие выплаты) против прод-API. Самоочистка.

  OWNER_PASSWORD='...' python3 scripts/verify_8.py

Создаёт временные смены (в далёком будущем, чтобы не мешать реальным), проверяет
выплату по сменам из разных недель, is_paid, unpaid, 409 на занятую смену, удаление.
"""
import os
import sys
import json
import urllib.request
import urllib.error

API = os.getenv("API_URL", "https://api-production-0fe39.up.railway.app")
EMAIL = os.getenv("OWNER_EMAIL", "rodion2yalanskiy@axiom-void.com")
PASSWORD = os.getenv("OWNER_PASSWORD", "")
results = []


def req(method, path, token=None, body=None):
    url = API + path
    headers = {}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
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


def main():
    if not PASSWORD:
        print("!! Задай OWNER_PASSWORD", file=sys.stderr); sys.exit(2)
    st, login = req("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    if st != 200 or not login.get("token"):
        print(f"!! Логин не прошёл ({st}): {login}", file=sys.stderr); sys.exit(2)
    tok = login["token"]
    wid = login["user"].get("worker_id") or 1
    print("→ supervisor вошёл\n")

    # Две смены в РАЗНЫХ календарных неделях (дек 2027, чтобы не мешать реальным).
    # 2027-12-01 (ср) и 2027-12-13 (пн) — гарантированно разные недели.
    made = []
    for d in ("2027-12-01", "2027-12-13"):
        st, s = req("POST", "/shifts", token=tok, body={
            "worker_id": wid, "date": d, "object_name": "L8-test",
            "start_min": 480, "end_min": 930, "has_lunch": False, "rate_override": 20})
        if st in (200, 201):
            made.append(s)
    check("подготовка: 2 смены в разных неделях созданы", len(made) == 2, f"создано {len(made)}")
    if len(made) != 2:
        print("!! не удалось создать тестовые смены", file=sys.stderr); sys.exit(1)
    ids = [s["id"] for s in made]
    each = made[0]["money"]  # 7.5ч * $20 = $150
    earned_expected = round(sum(s["money"] for s in made), 2)

    # 3) unpaid показывает обе
    st, unpaid = req("GET", f"/shifts/unpaid?worker_id={wid}", token=tok)
    up_ids = {s["id"] for s in unpaid} if st == 200 else set()
    check("3. /shifts/unpaid показывает новые смены", set(ids) <= up_ids, f"status={st}")

    # 1) выплата по сменам из РАЗНЫХ недель → earned = сумма
    st, pay = req("POST", "/payouts", token=tok, body={
        "shift_ids": ids, "amount_paid": earned_expected})
    ok1 = st in (200, 201) and abs(pay.get("earned_by_hours", 0) - earned_expected) < 0.01
    check("1. выплата по сменам из разных недель, earned верный", ok1,
          f"status={st} earned={pay.get('earned_by_hours')} ожид={earned_expected}")
    pid = pay.get("id")
    check("1b. covered_shifts вернулись", len(pay.get("covered_shifts", [])) == 2, f"{len(pay.get('covered_shifts', []))}")

    # 2) та же смена в другую выплату → 409
    st, r = req("POST", "/payouts", token=tok, body={"shift_ids": [ids[0]], "amount_paid": each})
    check("2. повторный выбор оплаченной смены → 409", st == 409, f"status={st} {r.get('detail','')}")

    # 4) GET /shifts is_paid=true
    st, shifts = req("GET", f"/shifts?year=2027&month=12&worker_id={wid}", token=tok)
    paid_flags = {s["id"]: s.get("is_paid") for s in shifts} if st == 200 else {}
    check("4. GET /shifts is_paid=true для оплаченных", all(paid_flags.get(i) for i in ids), f"{paid_flags}")

    # 3b) unpaid больше не показывает их
    st, unpaid2 = req("GET", f"/shifts/unpaid?worker_id={wid}", token=tok)
    up2 = {s["id"] for s in unpaid2} if st == 200 else set()
    check("3b. /shifts/unpaid больше не содержит оплаченные", not (set(ids) & up2), f"пересечение={set(ids) & up2}")

    # 7) чужую смену — эмулировать сложно (один tenant); проверяем несуществующую → 404
    st, r = req("POST", "/payouts", token=tok, body={"shift_ids": [99999999], "amount_paid": 10})
    check("7. несуществующая смена → 404", st == 404, f"status={st}")

    # 5) удалить выплату → смены снова unpaid
    if pid:
        st, _ = req("DELETE", f"/payouts/{pid}", token=tok)
        check("5. удаление выплаты → 200", st in (200, 204), f"status={st}")
        st, unpaid3 = req("GET", f"/shifts/unpaid?worker_id={wid}", token=tok)
        up3 = {s["id"] for s in unpaid3} if st == 200 else set()
        check("5b. после удаления смены снова unpaid", set(ids) <= up3, f"status={st}")

    # ── Очистка ──
    print("\n→ очистка тестовых смен…")
    for i in ids:
        req("DELETE", f"/shifts/{i}", token=tok)

    npass = sum(1 for r in results if r)
    print(f"\nИтог: {npass}/{len(results)} проверок пройдено.")
    sys.exit(0 if npass == len(results) else 1)


if __name__ == "__main__":
    main()
