#!/usr/bin/env python3
"""Одноразовый занос исторических смен Родиона (май–июль 2026) через API.

Принцип: часы из таблицы — истина → end_min = start_min + hours*60 (has_lunch=false →
сервер вернёт ровно эти часы). Ставки старых смен ЯВНЫЕ (rate_override, supervisor-only):
27–28 мая = $20/час, остальные = $25/час. Текущая ставка профиля ($27) НЕ трогается.
Выплаты НЕ создаём.

Режим REPLACE: если смена с таким (дата, объект) уже есть — удаляем и создаём заново
(чтобы исправить снапшот ставки). Идемпотентно.

Запуск:  OWNER_PASSWORD=... python3 scripts/backfill_shifts.py
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


# (week, date, object, start_min, hours, rate)
SHIFTS = [
    ("A", "2026-05-27", "театр", hm(8, 30), 9.0, 20),
    ("A", "2026-05-28", "театр", hm(10, 30), 6.5, 20),
    ("A", "2026-06-02", "театр", hm(10, 30), 5.5, 25),
    ("A", "2026-06-03", "театр", hm(14, 0), 3.5, 25),
    ("A", "2026-06-04", "театр", hm(8, 0), 9.0, 25),
    ("B", "2026-06-08", "помощь Алексу", hm(9, 30), 6.0, 25),
    ("B", "2026-06-09", "помощь Алексу", hm(8, 0), 9.5, 25),
    ("B", "2026-06-11", "театр", hm(8, 0), 9.5, 25),
    ("B", "2026-06-12", "Ванкувер Женя", hm(8, 0), 9.0, 25),
    ("C", "2026-06-15", "Ванкувер Женя", hm(13, 30), 5.5, 25),
    ("C", "2026-06-16", "Ванкувер Женя", hm(8, 0), 10.5, 25),
    ("C", "2026-06-17", "Ванкувер Женя", hm(8, 0), 10.5, 25),
    ("C", "2026-06-18", "Ванкувер Женя", hm(8, 0), 9.0, 25),
    ("D", "2026-06-23", "Ванкувер Женя", hm(8, 0), 4.0, 25),
    ("D", "2026-06-24", "Ванкувер Женя", hm(8, 0), 8.5, 25),
    ("D", "2026-06-25", "Ванкувер Женя", hm(8, 0), 9.5, 25),
    ("D", "2026-06-26", "Ванкувер Женя", hm(8, 0), 10.0, 25),
    ("D", "2026-06-27", "Ванкувер Женя", hm(8, 0), 8.5, 25),
    ("E", "2026-06-29", "Battleground Костя", hm(8, 30), 7.0, 25),
    ("E", "2026-06-30", "Ванкувер Коля", hm(8, 0), 7.5, 25),
    ("E", "2026-07-02", "Ванкувер Коля", hm(8, 0), 10.0, 25),
    ("E", "2026-07-03", "Ванкувер 137 Женя", hm(8, 0), 6.5, 25),
]
EXPECTED_WEEK = {"A": 33.5, "B": 34.0, "C": 35.5, "D": 40.5, "E": 31.0}


def fmt(h):
    return (str(int(h)) if h == int(h) else str(h).replace(".", ",")) + "ч"


def usd(x):
    return "$" + (str(int(x)) if x == int(x) else f"{x:.2f}")


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

    # Существующие смены (для REPLACE) за май/июнь/июль 2026 → (date,object) -> id.
    existing = {}
    for m in (5, 6, 7):
        for s in req("GET", f"/shifts?year=2026&month={m}&worker_id={worker_id}", token)[1] or []:
            existing[(s["date"], s["object_name"])] = s["id"]

    rows = []
    week_hours = {}
    week_money = {}
    for week, date, obj, start_min, hours, rate in SHIFTS:
        end_min = start_min + int(round(hours * 60))
        replaced = ""
        if (date, obj) in existing:
            dst, _ = req("DELETE", f"/shifts/{existing[(date, obj)]}", token)
            replaced = "replace" if dst in (200, 204) else f"del?{dst}"
        st, r = req("POST", "/shifts", token, {
            "worker_id": worker_id, "date": date, "object_name": obj,
            "start_min": start_min, "end_min": end_min,
            "has_lunch": False, "suppress_notification": True, "rate_override": rate,
        })
        got_h = r.get("calculated_hours") if isinstance(r, dict) else None
        got_rate = r.get("hourly_rate") if isinstance(r, dict) else None
        got_money = r.get("money") if isinstance(r, dict) else None
        exp_money = round(hours * rate, 2)
        good = st == 200 and got_h == hours and got_rate == rate and got_money == exp_money
        mark = ("✓ " + replaced).strip() if good else f"✗({st}) h={got_h} rate={got_rate} m={got_money}"
        rows.append((week, date, obj, to_hhmm(start_min), to_hhmm(end_min), got_h, rate, got_money, hours, mark))
        week_hours[week] = week_hours.get(week, 0.0) + (got_h or 0.0)
        week_money[week] = week_money.get(week, 0.0) + (got_money or 0.0)

    print(f"{'Нед':<4}{'Дата':<12}{'Объект':<20}{'нач':<7}{'кон':<7}{'часы':<7}{'ст.':<6}{'деньги':<9}{'ok'}")
    print("-" * 88)
    mism = []
    for week, date, obj, sm, em, got_h, rate, money, exp, mark in rows:
        gh = fmt(got_h) if got_h is not None else "—"
        print(f"{week:<4}{date:<12}{obj[:19]:<20}{sm:<7}{em:<7}{gh:<7}{usd(rate):<6}{usd(money) if money is not None else '—':<9}{mark}")
        if got_h != exp:
            mism.append((date, obj, got_h, exp))

    print("\n=== Суммы по неделям (часы · деньги) ===")
    th = tm = 0.0
    for w in ("A", "B", "C", "D", "E"):
        h = round(week_hours.get(w, 0.0), 2)
        mo = round(week_money.get(w, 0.0), 2)
        th += h
        tm += mo
        ok = "✓" if h == EXPECTED_WEEK[w] else "✗"
        print(f"  Неделя {w}: {fmt(h):<8} · {usd(mo):<9} (ожид. часы {fmt(EXPECTED_WEEK[w])})  {ok}")
    print(f"\n  ОБЩИЙ ИТОГ: {fmt(round(th, 2))} · заработано {usd(round(tm, 2))}")

    if mism:
        print("\n!! Расхождения по часам:")
        for date, obj, got, exp in mism:
            print(f"   {date} {obj}: {got} ≠ {exp}")
    else:
        print("\nРасхождений по часам нет — всё совпало с таблицей.")

    print("\nСТАВКИ: 27–28 мая @ $20, остальные @ $25 (rate_override). Ставка профиля ($27) не менялась.")
    print("ВЫПЛАТЫ НЕ СОЗДАВАЛИСЬ — только смены. Чеки недель A–D Родион сфоткает позже; E ждёт босса.")


if __name__ == "__main__":
    main()
