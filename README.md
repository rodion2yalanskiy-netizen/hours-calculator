# Калькулятор часов

Личный рабочий инструмент Родиона (маляр, $25/час). Telegram Mini App для учёта смен/часов.
**Отдельный проект, НЕ часть Axiom:Void CRM.** Своя БД, свой Railway-проект.

> Доступ только владельцу (OWNER_ID). Чужие Telegram-id получают 403.

## Архитектура (3 части + БД)

```
Telegram ──/start──> [bot]  ──кнопка web_app──>  [frontend (Vercel)]
                                                       │ initData
                                                       ▼  X-Telegram-Init-Data
                                                  [api (FastAPI)] ──> [Postgres]
```

- **bot/** — Python + aiogram 3.x. Railway-сервис. Только открывает Mini App.
- **api/** — Python + FastAPI. Railway-сервис. Проверяет подпись initData + owner-id, ходит в БД. Владелец схемы БД.
- **frontend/** — React + Vite + TypeScript + Tailwind. Vercel. В БД напрямую НЕ ходит — только через API.
- **Postgres** — отдельный экземпляр на Railway (НЕ база CRM).

## Деплой

| Часть | Куда | Root directory |
|---|---|---|
| api | Railway (новый проект `hours-calculator`) | `/api` |
| bot | Railway (тот же проект) | `/bot` |
| frontend | Vercel | `/frontend` |
| Postgres | Railway (тот же проект) | — |

## Переменные окружения (вставляются вручную в Railway/Vercel, НЕ в git)

### api (Railway)
| Переменная | Назначение |
|---|---|
| `BOT_TOKEN` | токен бота — для проверки подписи initData (HMAC) |
| `DATABASE_URL` | подключение к новому Postgres (Railway даёт сам) |
| `OWNER_ID` | numeric Telegram id владельца (сид бригады + legacy tenant-ключ) |
| `CORS_ORIGIN` | домен фронта на Vercel (на этапе сборки временно `*`, перед приёмкой сузить!) |
| `OWNER_EMAIL` | email supervisor'а (Слой 2) — логин для веб-приложения |
| `OWNER_INITIAL_PASSWORD` | стартовый пароль supervisor'а → bcrypt-хэш при первом сиде |
| `OWNER_FULL_NAME` | отображаемое имя supervisor'а |
| `JWT_SECRET` | секрет подписи JWT (`openssl rand -hex 32`) |

### bot (Railway)
| Переменная | Назначение |
|---|---|
| `BOT_TOKEN` | тот же токен бота — для работы бота |
| `MINIAPP_URL` | URL фронта на Vercel (для кнопки web_app) |
| `OWNER_ID` | (опц.) ограничить /start владельцем |

### frontend (Vercel, build-time)
| Переменная | Назначение |
|---|---|
| `VITE_API_URL` | URL сервиса api на Railway |

> **BOT_TOKEN заводится в ДВУХ сервисах** — в `bot` (работа бота) и в `api` (проверка подписи). Это нормально, один и тот же токен.

## Безопасность

- Подпись initData проверяется **готовой функцией** `aiogram.utils.web_app.safe_parse_webapp_init_data` (правильный порядок HMAC: `secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)`). Невалидно → 401.
- После подписи — сверка `user.id == OWNER_ID`. Не совпало → 403.
- Секреты только в env. `.env` в `.gitignore`.

## Аутентификация (Слой 2)

Веб-приложение переходит с Telegram-initData на **JWT**. Все эндпоинты api (кроме
`/health` и `/auth/login`) требуют заголовок `Authorization: Bearer <token>`.

- **Роли:** `supervisor` (Родион — видит всё) и `worker` (видит только себя; ролевая
  фильтрация данных — Слой 3). Проверка роли — зависимость `require_supervisor`.
- **Supervisor-аккаунт** создаётся автоматически при первом старте api, если таблица
  `users` пуста, из env `OWNER_EMAIL` / `OWNER_INITIAL_PASSWORD` / `OWNER_FULL_NAME`
  (`role='supervisor'`, `hourly_rate=27.00`, привязка к worker'у Родиона).
- **Токен:** HS256, срок 7 дней, payload `{user_id, role, worker_id, exp}`, секрет `JWT_SECRET`.
- **Пароли:** bcrypt. Смена пароля — `POST /auth/change-password` (новый пароль: 8+ символов, буквы и цифры).

**Обязательные env (Слой 2):** `OWNER_EMAIL`, `OWNER_INITIAL_PASSWORD`, `OWNER_FULL_NAME`, `JWT_SECRET`.

### Примеры (curl)

Логин → получить токен:
```bash
curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"rodion2yalanskiy@axiom-void.com","password":"Rodion2002"}'
# → {"token":"<JWT>","user":{"id":"...","full_name":"Родион","role":"supervisor","hourly_rate":27.0}}
```

Текущий пользователь с токеном:
```bash
curl -s "$API/auth/me" -H "Authorization: Bearer $TOKEN"
# → {"id":"...","email":"...","full_name":"Родион","role":"supervisor","hourly_rate":27.0,"worker_id":1}
```

Защищённый эндпоинт без токена → 401:
```bash
curl -s -o /dev/null -w '%{http_code}\n' "$API/shifts?year=2026&month=6"   # 401
curl -s "$API/shifts?year=2026&month=6" -H "Authorization: Bearer $TOKEN"   # 200
```

## Эндпоинты (Слой 3 — ролевая модель)

Все требуют `Authorization: Bearer <token>`. `supervisor` видит/ведёт всю команду, `worker` — только себя.

| Метод | Путь | Роль | Назначение |
|---|---|---|---|
| GET | `/workers` | обе | supervisor — вся команда; worker — только он сам |
| POST | `/workers` | supervisor | низкоуровневое создание строки `workers` (без user) |
| PATCH | `/workers/{id}` | supervisor | правка своего работника |
| POST | `/shifts` | обе | worker пишет только за себя; ставка → `hourly_rate_snapshot` |
| GET | `/shifts?year=&month=[&worker_id=]` | обе | worker — свои; supervisor — команда (опц. фильтр) |
| GET | `/team` | supervisor | список членов команды (user-данные) |
| POST | `/team` | supervisor | завести работника: `workers` + `users` разом |
| PATCH | `/team/{user_id}` | supervisor | имя / ставка / активность / пароль |
| GET | `/payouts[?worker_id=&from=&to=]` | обе | недельные выплаты (worker — свои) |
| POST | `/payouts` | обе | внести выплату за неделю (свою) |
| PATCH/DELETE | `/payouts/{id}` | обе | правка/удаление своей выплаты |
| GET | `/summary/weekly?week_start=[&worker_id=]` | обе | сводка за неделю |
| GET | `/summary/period?from=&to=[&worker_id=]` | обе | сводка по неделям (supervisor без worker_id — вся команда) |

**Бонус/долг/штраф:** `earned_by_hours` = Σ(часы × `hourly_rate_snapshot`) за неделю. Если `amount_paid > earned` → `bonus`; если меньше → `shortfall` + обязательный `shortfall_reason` (`debt`/`fine`; для `fine` обязателен `shortfall_note`).

### Примеры (curl)

Supervisor заводит работника → тот логинится:
```bash
curl -s -X POST "$API/team" -H "Authorization: Bearer $SUP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"denis@example.com","password":"denis1234","full_name":"Денис","hourly_rate":24.00}'
# → {"user_id":"...","worker_id":5,"email":"denis@example.com","full_name":"Денис","hourly_rate":24.0}
curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"denis@example.com","password":"denis1234"}'   # → токен worker'а
```

Worker вносит смену (ставка проставится автоматически) и выплату за неделю:
```bash
curl -s -X POST "$API/shifts" -H "Authorization: Bearer $W_TOKEN" -H 'Content-Type: application/json' \
  -d '{"worker_id":0,"date":"2026-06-15","object_name":"Oak St","start_min":480,"end_min":1020,"hours":8.5,"lunch_deducted":true}'
curl -s -X POST "$API/payouts" -H "Authorization: Bearer $W_TOKEN" -H 'Content-Type: application/json' \
  -d '{"week_start":"2026-06-15","week_end":"2026-06-21","amount_paid":250}'   # bonus если > earned
```

Сводка за неделю:
```bash
curl -s "$API/summary/weekly?week_start=2026-06-15" -H "Authorization: Bearer $W_TOKEN"
curl -s "$API/summary/period?from=2026-06-01&to=2026-06-28" -H "Authorization: Bearer $SUP_TOKEN"  # вся команда
```

## Схема БД

Единственный владелец схемы — **api** (`api/migrations/001_init.sql`, применяется идемпотентно на старте api под advisory-lock). Бот схему не создаёт.

Слой 2 добавил: таблицу `users` (логин/роль/ставка), `shifts.hourly_rate_snapshot`
(фиксация ставки в смене; существующие смены — $25, новые по умолчанию $27), таблицу
`weekly_payouts` (недельные выплаты с логикой долг/штраф) и убрал `workers.count_money`
(деньги считаются всегда). Примечание: ссылки на работника — `bigint REFERENCES workers(id)`,
т.к. `workers.id` — `bigserial`.

## Тестирование вне Telegram

Фронт поддерживает `mockTelegramEnv` (@telegram-apps/sdk-react) — можно открыть в обычном браузере с фейковым пользователем для отладки, не завися от телефона.

## Слои разработки

- **Слой 0:** скелет — `/start` → Mini App → «Привет, Родион ✓ подпись проверена».
- **Слой 1а:** бригада (`workers`) и смены (`shifts`).
- **Слой 2:** аутентификация JWT + роли supervisor/worker, `hourly_rate_snapshot` в сменах, недельные выплаты (`weekly_payouts`). Эндпоинты переведены с Telegram-id на Bearer-токен.
- **Слой 3 (текущий):** ролевая фильтрация `/workers` и `/shifts`, управление командой `/team`, CRUD выплат `/payouts`, сводки `/summary/weekly` и `/summary/period` (earned/paid/bonus/долг/штраф). Схема БД не менялась.
- **Слой 4 (дальше):** фронтенд с логином и экранами (Мои смены / Команда / Выплаты / Сводка), тёмная emerald-палитра.
