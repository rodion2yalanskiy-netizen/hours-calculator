"""Калькулятор часов — бот (aiogram 3.x). Слой 0: только /start.

/start → приветствие на русском + inline-кнопка web_app, открывающая Mini App
(MINIAPP_URL из env). Больше ничего бот в Слое 0 не делает.
Опционально ограничен по OWNER_ID (личный инструмент).
"""
import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    Message,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    WebAppInfo,
)

from config import BOT_TOKEN, MINIAPP_URL, OWNER_ID

logger = logging.getLogger("hours-bot")
dp = Dispatcher()


@dp.message(CommandStart())
async def on_start(message: Message) -> None:
    # Owner-only (если OWNER_ID задан): чужим не открываем.
    if OWNER_ID and message.from_user and message.from_user.id != OWNER_ID:
        await message.answer("Это личный инструмент. Доступ только владельцу.")
        return

    if not MINIAPP_URL:
        # На случай незаданного env — не падаем, сообщаем явно.
        logger.warning("MINIAPP_URL не задан — кнопку web_app показать нельзя")
        await message.answer("Калькулятор ещё настраивается (MINIAPP_URL не задан).")
        return

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[
            InlineKeyboardButton(
                text="🧮 Открыть калькулятор",
                web_app=WebAppInfo(url=MINIAPP_URL),
            )
        ]]
    )
    await message.answer(
        "Привет! Это твой калькулятор часов.\nЖми кнопку ниже, чтобы открыть 👇",
        reply_markup=keyboard,
    )


async def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN не задан в окружении")
    bot = Bot(BOT_TOKEN)
    logger.info("Бот запущен (polling)")
    await dp.start_polling(bot)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    asyncio.run(main())
