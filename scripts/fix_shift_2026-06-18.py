"""Правка одной смены Родиона (worker_id=1): чт 18 июня 2026, «Ванкувер Женя», 9,0ч → 7,5ч.
08:00–15:30, без обеда. Ставка не трогается ($25). Неделя C (15–18 июня) должна дать 34ч.

Запуск:  OWNER_PASSWORD='...' python3 scripts/fix_shift_2026-06-18.py
"""
import os
import sys
import json
import urllib.request
import urllib.error

API = os.getenv("API_URL", "https://api-production-0fe39.up.railway.app")
EMAIL = os.getenv("OWNER_EMAIL", "rodion2yalanskiy@axiom-void.com")
PASSWORD = os.getenv("OWNER_PASSWORD", "")

TARGET_DATE = "2026-06-18"
WORKER_ID = 1
NEW_START, NEW_END = 480, 930  # 08:00 – 15:30 = 7,5ч без обеда


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
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read().decode()
            return resp.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt}


def main():
    if not PASSWORD:
        print("!! Задай OWNER_PASSWORD в окружении.", file=sys.stderr)
        sys.exit(2)

    st, login = req("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
    if st != 200 or not login.get("token"):
        print(f"!! Логин не прошёл ({st}): {login}", file=sys.stderr)
        sys.exit(2)
    tok = login["token"]
    if login["user"]["role"] != "supervisor":
        print(f"!! Не supervisor: {login['user']['role']}", file=sys.stderr)
        sys.exit(2)
    print(f"→ Вошёл как supervisor ({EMAIL})\n")

    # 1) Найти смену на 2026-06-18 у worker_id=1
    st, shifts = req("GET", f"/shifts?year=2026&month=6&worker_id={WORKER_ID}", token=tok)
    if st != 200:
        print(f"!! GET /shifts не прошёл ({st}): {shifts}", file=sys.stderr)
        sys.exit(2)
    target = [s for s in shifts if s["date"] == TARGET_DATE]
    if not target:
        print(f"!! Смена на {TARGET_DATE} у worker {WORKER_ID} не найдена. Есть даты: "
              f"{sorted(s['date'] for s in shifts)}", file=sys.stderr)
        sys.exit(1)
    if len(target) > 1:
        print(f"!! Найдено {len(target)} смен на {TARGET_DATE} — уточни вручную: {target}", file=sys.stderr)
        sys.exit(1)
    sh = target[0]
    print(f"Найдена смена id={sh['id']}: {sh['date']} «{sh['object_name']}» "
          f"{sh['calculated_hours']}ч, ставка ${sh['hourly_rate']}, "
          f"start_min={sh['start_min']} end_min={sh['end_min']}")

    if abs(float(sh["calculated_hours"]) - 7.5) < 0.001:
        print("→ Уже 7,5ч — правка не нужна, пропускаю PATCH.")
    else:
        # 2) PATCH → 08:00–15:30, без обеда
        st, patched = req("PATCH", f"/shifts/{sh['id']}", token=tok,
                          body={"start_min": NEW_START, "end_min": NEW_END, "has_lunch": False})
        if st != 200:
            print(f"!! PATCH не прошёл ({st}): {patched}", file=sys.stderr)
            sys.exit(2)
        print(f"→ PATCH ок: теперь {patched['calculated_hours']}ч, "
              f"{patched['start_min']}→{patched['end_min']} мин, ставка ${patched['hourly_rate']}, "
              f"деньги ${patched['money']}")
        if abs(float(patched["calculated_hours"]) - 7.5) > 0.001:
            print(f"!! ОШИБКА: ожидалось 7,5ч, получено {patched['calculated_hours']}ч", file=sys.stderr)
            sys.exit(1)

    # 3) Проверка GET /shifts заново
    st, shifts2 = req("GET", f"/shifts?year=2026&month=6&worker_id={WORKER_ID}", token=tok)
    check = next((s for s in shifts2 if s["date"] == TARGET_DATE), None)
    print(f"\nПерепроверка {TARGET_DATE}: {check['calculated_hours']}ч, "
          f"деньги ${check['money']} (ожидалось 7,5ч / $187.5)")

    # 4) Неделя C: 15–18 июня
    week_c_dates = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"]
    week = {s["date"]: s for s in shifts2 if s["date"] in week_c_dates}
    print("\nНеделя C (15–18 июня):")
    total = 0.0
    for d in week_c_dates:
        if d in week:
            h = float(week[d]["calculated_hours"])
            total += h
            print(f"  {d}  «{week[d]['object_name']}»  {h}ч")
        else:
            print(f"  {d}  — смены нет")
    print(f"  ИТОГО: {total}ч (цель 34ч, чек $850)")
    if abs(total - 34.0) < 0.001:
        print("  ✅ Сходится с чеком.")
    else:
        print(f"  ⚠️ НЕ 34ч — расхождение {round(total - 34, 2)}ч. Проверь остальные дни недели.")


if __name__ == "__main__":
    main()
