#!/usr/bin/env python3
"""Одноразовый занос исторических смен Родиона (май–июль 2026) через API.

Принцип: часы из таблицы — истина. end_min = start_min + hours*60 (has_lunch=false →
сервер вернёт ровно эти часы, т.к. net кратен 30). Выплаты НЕ создаём.

Запуск:  OWNER_PASSWORD=... python3 scripts/backfill_shifts.py
Опц. env: API_URL, OWNER_EMAIL.
Идемпотентно: пропускает уже существующие смены (по дате+объекту).
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = os.getenv("API_URL", "https://api-production-0fe39.up.railway.app")
EMAIL = os.getenv("OWNER_EMAIL", "rodion2yalanskiy@axiom-void.com")
PASSWORD = os.getenv("OWNER_PASSWORD", "")


def req(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or "null")
        except Exception:
            return e.code, None


def hm(h, m):
    return h * 60 + m


# (week, date, object, start_min, hours). end вычисляется = start + hours*60.
SHIFTS = [
    # Неделя A — театр (ожид. 33,5)
    ("A", "2026-05-27", "театр", hm(8, 30), 9.0),
    ("A", "2026-05-28", "театр", hm(10, 30), 6.5),
    ("A", "2026-06-02", "театр", hm(10, 30), 5.5),
    ("A", "2026-06-03", "театр", hm(14, 0), 3.5),
    ("A", "2026-06-04", "театр", hm(8, 0), 9.0),
    # Неделя B (ожид. 34)
    ("B", "2026-06-08", "помощь Алексу", hm(9, 30), 6.0),
    ("B", "2026-06-09", "помощь Алексу", hm(8, 0), 9.5),
    ("B", "2026-06-11", "театр", hm(8, 0), 9.5),
    ("B", "2026-06-12", "Ванкувер Женя", hm(8, 0), 9.0),
    # Неделя C — Ванкувер Женя (ожид. 35,5; «34» в переписке было опечаткой Родиона)
    ("C", "2026-06-15", "Ванкувер Женя", hm(13, 30), 5.5),
    ("C", "2026-06-16", "Ванкувер Женя", hm(8, 0), 10.5),
    ("C", "2026-06-17", "Ванкувер Женя", hm(8, 0), 10.5),
    ("C", "2026-06-18", "Ванкувер Женя", hm(8, 0), 9.0),
    # Неделя D — Ванкувер Женя (ожид. 40,5)
    ("D", "2026-06-23", "Ванкувер Женя", hm(8, 0), 4.0),
    ("D", "2026-06-24", "Ванкувер Женя", hm(8, 0), 8.5),
    ("D", "2026-06-25", "Ванкувер Женя", hm(8, 0), 9.5),
    ("D", "2026-06-26", "Ванкувер Женя", hm(8, 0), 10.0),
    ("D", "2026-06-27", "Ванкувер Женя", hm(8, 0), 8.5),
    # Неделя E — босс не рассчитался (выплату НЕ создаём) (ожид. 31)
    ("E", "2026-06-29", "Battleground Костя", hm(8, 30), 7.0),
    ("E", "2026-06-30", "Ванкувер Коля", hm(8, 0), 7.5),
    ("E", "2026-07-02", "Ванкувер Коля", hm(8, 0), 10.0),
    ("E", "2026-07-03", "Ванкувер 137 Женя", hm(8, 0), 6.5),
]

EXPECTED_WEEK = {"A": 33.5, "B": 34.0, "C": 35.5, "D": 40.5, "E": 31.0}


def fmt(h):
    return (str(int(h)) if h == int(h) else str(h).replace(".", ",")) + "ч"


def to_hhmm(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def main():
    if not PASSWORD:
        print("!! Задай OWNER_PASSWORD в окружении.", file=sys.stderr)
        sys.exit(1)
    st, login = req("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    if st != 200 or not login.get("token"):
        print(f"!! Логин не прошёл ({st}): {login}", file=sys.stderr)
        sys.exit(1)
    token = login["token"]
    me = req("GET", "/auth/me", token)[1]
    worker_id = me["worker_id"]
    print(f"Залогинен: {me['full_name']} (worker_id={worker_id}, role={me['role']})\n")

    # Существующие смены (дедуп по дате+объекту) за май/июнь/июль 2026.
    existing = set()
    for m in (5, 6, 7):
        for s in req("GET", f"/shifts?year=2026&month={m}&worker_id={worker_id}", token)[1] or []:
            existing.add((s["date"], s["object_name"]))

    rows = []
    week_hours = {}
    for week, date, obj, start_min, hours in SHIFTS:
        end_min = start_min + int(round(hours * 60))
        if (date, obj) in existing:
            rows.append((week, date, obj, start_min, end_min, None, hours, "skip (уже есть)"))
            week_hours.setdefault(week, 0.0)
            week_hours[week] += hours  # уже занесена ранее — учитываем в сумме
            continue
        st, r = req("POST", "/shifts", token, {
            "worker_id": worker_id, "date": date, "object_name": obj,
            "start_min": start_min, "end_min": end_min,
            "has_lunch": False, "suppress_notification": True,
        })
        got = r.get("calculated_hours") if isinstance(r, dict) else None
        okmark = "✓" if (st == 200 and got == hours) else f"✗ ({st})"
        rows.append((week, date, obj, start_min, end_min, got, hours, okmark))
        week_hours.setdefault(week, 0.0)
        week_hours[week] += (got if got is not None else 0.0)

    # Отчёт
    print(f"{'Нед':<4}{'Дата':<12}{'Объект':<22}{'начало':<8}{'конец':<8}{'занес.':<9}{'ожид.':<8}{'ok'}")
    print("-" * 82)
    mismatches = []
    for week, date, obj, sm, em, got, exp, mark in rows:
        gs = fmt(got) if got is not None else "—"
        print(f"{week:<4}{date:<12}{obj[:21]:<22}{to_hhmm(sm):<8}{to_hhmm(em):<8}{gs:<9}{fmt(exp):<8}{mark}")
        if got is not None and got != exp:
            mismatches.append((date, obj, got, exp))

    print("\n=== Суммы по неделям ===")
    total = 0.0
    for w in ("A", "B", "C", "D", "E"):
        got = round(week_hours.get(w, 0.0), 2)
        total += got
        ok = "✓" if got == EXPECTED_WEEK[w] else "✗"
        print(f"  Неделя {w}: {fmt(got):<8} (ожид. {fmt(EXPECTED_WEEK[w])})  {ok}")
    print(f"\n  ОБЩИЙ ИТОГ: {fmt(round(total, 2))}  (ожид. {fmt(sum(EXPECTED_WEEK.values()))})")

    if mismatches:
        print("\n!! Расхождения (занесённые ≠ ожидаемым):")
        for date, obj, got, exp in mismatches:
            print(f"   {date} {obj}: занесено {fmt(got)}, ожидалось {fmt(exp)}")
    else:
        print("\nРасхождений нет — все занесённые часы совпали с таблицей.")

    print("\nВЫПЛАТЫ НЕ СОЗДАВАЛИСЬ (только смены). Родион сфотографирует чеки по неделям A–D позже; E ждёт расчёта босса.")


if __name__ == "__main__":
    main()
