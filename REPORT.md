# Отчёт — закрытие публичного доступа к API-документации

## Что сделано
1. Добавлен флаг `ENABLE_DOCS` (env, по умолчанию `false`) в `api/config.py`.
2. В `api/main.py` `FastAPI(...)` теперь получает `docs_url`/`redoc_url`/`openapi_url` = `None`, если `ENABLE_DOCS` не `true` — эндпоинты `/docs`, `/redoc`, `/openapi.json` полностью отключены на уровне FastAPI (не просто скрыты, а не зарегистрированы → 404).
3. Чтобы включить документацию себе (например, для отладки) — выставить `ENABLE_DOCS=true` в Railway и передеплоить.

## Файлы изменены
- `api/config.py` — добавлена переменная `ENABLE_DOCS`
- `api/main.py` — `docs_url`/`redoc_url`/`openapi_url` управляются флагом
- Коммит: `chore: disable public API docs in production (audit 🟢)`

## Что проверено
- Локально (python3.11, установлены зависимости из `requirements.txt`):
  - Без `ENABLE_DOCS` (по умолчанию): `app.docs_url`, `app.redoc_url`, `app.openapi_url` → `None` (эндпоинты не регистрируются, GET вернёт 404).
  - С `ENABLE_DOCS=true`: `app.docs_url` = `/docs`, `app.redoc_url` = `/redoc`, `app.openapi_url` = `/openapi.json` — работает как раньше.
- Остальные эндпоинты и авторизация не затронуты (изменение ограничено параметрами конструктора `FastAPI(...)`).

## Что задеплоено
- Пуш в `main` → Railway задеплоит автоматически. **По умолчанию `ENABLE_DOCS` не задан в Railway → docs будут выключены сразу после деплоя.**
- Фронт (Vercel) не затронут — изменения не касаются.

## Рекомендации / риски
- Если сейчас в Railway кто-то полагается на `/docs` для проверки API вручную — стоит добавить `ENABLE_DOCS=true` в переменные окружения Railway перед следующим деплоем, если нужен доступ.
- Риска в работе приложения нет: изменение затрагивает только авто-документацию FastAPI.
