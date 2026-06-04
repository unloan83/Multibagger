from telegram import Update
from telegram.ext import Application, CommandHandler

async def start(update: Update, context):
    await update.message.reply_text("Welcome to India MultiBagger AI Bot! Use /scan for today's picks.")

async def daily_scan(context):
    results = run_full_scan()  # Your main function
    message = f"🚀 Today's Multi-Bagger Alerts (India Small-Cap)\n\n"
    for stock in results[:5]:
        message += f"• {stock['ticker']} | Score: {stock['score']}/10\n"
        message += f"   {stock['reason'][:150]}...\n\n"
    
    await context.bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=message)

# Schedule daily at 8:30 AM IST
