"""Калькулятор часов — API (FastAPI). Слой 0: только /health и /me.

/me — принимает initData в заголовке X-Telegram-Init-Data, проверяет подпись
и owner-id (через require_owner), возвращает {id, name, username} или 401/403.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from auth import require_owner
from db import run_migrations
from config import CORS_ORIGIN


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Единственный владелец схемы: применяем миграцию на старте (идемпотентно, под lock).
    await run_migrations()
    yield


app = FastAPI(title="Калькулятор часов API", lifespan=lifespan)

# CORS: фронт (Vercel) → API (Railway). На сборке CORS_ORIGIN="*", перед приёмкой — домен Vercel.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if CORS_ORIGIN == "*" else [CORS_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,  # initData идёт в заголовке, cookie-креды не нужны
)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/me")
async def me(user=Depends(require_owner)):
    name = (user.first_name or "")
    if user.last_name:
        name = f"{name} {user.last_name}".strip()
    return {"id": user.id, "name": name.strip(), "username": user.username}
