"""calc.py — расчёт часов смены. Чистая математика, без БД.

Слой 7e: автоопределение обеда по окну времени УБРАНО. Обед теперь — явная галочка
работника (has_lunch). Правило округления (остаток <15 вниз, >20 вверх, 15–20 выбор)
НЕ меняется.
"""

LUNCH_MIN = 30
RATE = 25


def _round_half_hour(net_min):
    """Округление чистых минут до получаса. НЕ меняем (правило зафиксировано)."""
    if net_min < 0:
        net_min = 0
    base_half = net_min // 30
    remainder = net_min % 30
    down = base_half * 0.5
    up = (base_half + 1) * 0.5
    if remainder < 15:
        return {"needs_round_choice": False, "hours": down}
    elif remainder > 20:
        return {"needs_round_choice": False, "hours": up}
    else:
        return {"needs_round_choice": True, "hours_down": down, "hours_up": up}


def preview_shift(start_min, end_min, has_lunch=True):
    """has_lunch=True → вычесть 30 мин обеда; False → не вычитать.
    Возвращает {lunch_deducted, round}. needs_lunch_choice больше нет — решает галочка."""
    gross = end_min - start_min
    if gross < 0:
        gross += 24 * 60
    net = gross - (LUNCH_MIN if has_lunch else 0)
    return {
        "lunch_deducted": has_lunch,
        "round": _round_half_hour(net),
    }


def money(hours):
    return round(hours * RATE, 2)
