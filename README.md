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
| `OWNER_ID` | numeric Telegram id владельца (доступ только ему) |
| `CORS_ORIGIN` | домен фронта на Vercel (на этапе сборки временно `*`, перед приёмкой сузить!) |

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

## Схема БД

Единственный владелец схемы — **api** (`api/migrations/001_init.sql`, применяется идемпотентно на старте api под advisory-lock). Бот схему не создаёт.

## Тестирование вне Telegram

Фронт поддерживает `mockTelegramEnv` (@telegram-apps/sdk-react) — можно открыть в обычном браузере с фейковым пользователем для отладки, не завися от телефона.

## Слои разработки

- **Слой 0 (текущий):** скелет — `/start` → Mini App → «Привет, Родион ✓ подпись проверена». Без функций.
- Дальше: смены, недели, долги, настройки (по ТЗ).
