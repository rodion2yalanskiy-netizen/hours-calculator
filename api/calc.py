"""calc.py — расчёт часов смены. Чистая математика, без БД."""

LUNCH_MIN = 30
RATE = 25

LUNCH_START = 12 * 60
LUNCH_END = 12 * 60 + 30
SURE_LUNCH_START = 11 * 60 + 30
SURE_LUNCH_END = 13 * 60


def lunch_zone(start_min, end_min):
    if end_min <= LUNCH_START or start_min >= LUNCH_END:
        return "no"
    if start_min <= SURE_LUNCH_START and end_min >= SURE_LUNCH_END:
        return "yes"
    return "ask"


def _round_half_hour(net_min):
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


def preview_shift(start_min, end_min):
    gross = end_min - start_min
    if gross < 0:
        gross += 24 * 60
    zone = lunch_zone(start_min, end_min)

    def scenario(deduct):
        return _round_half_hour(gross - (LUNCH_MIN if deduct else 0))

    if zone == "no":
        return {"needs_lunch_choice": False, "lunch_deducted": False, "round": scenario(False)}
    if zone == "yes":
        return {"needs_lunch_choice": False, "lunch_deducted": True, "round": scenario(True)}
    return {"needs_lunch_choice": True, "with_lunch": scenario(True), "without_lunch": scenario(False)}


def money(hours):
    return round(hours * RATE, 2)
