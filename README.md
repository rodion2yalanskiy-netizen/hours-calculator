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
- **Слой 2 (текущий):** аутентификация JWT + роли supervisor/worker, `hourly_rate_snapshot` в сменах, недельные выплаты (`weekly_payouts`). Эндпоинты переведены с Telegram-id на Bearer-токен.
- **Слой 3 (дальше):** ролевая фильтрация данных, управление командой (`/users`), CRUD выплат, сводка earned/paid/bonus/debt, перенос долгов между неделями.
