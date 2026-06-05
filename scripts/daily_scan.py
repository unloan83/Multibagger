#!/usr/bin/env python
import os
import asyncio
from datetime import datetime
from core.data_collector import IndiaDataCollector
from core.analyzer import MultiBaggerAnalyzer
from core.scorer import calculate_final_score
from config import MIN_CONVICTION_SCORE

async def main():
    print(f"Scan started at: {datetime.now()} IST")
    
    collector = IndiaDataCollector()
    analyzer = MultiBaggerAnalyzer()
    
    news = collector.get_india_news("smallcap OR defence OR ev OR semiconductor OR renewable OR nuclear")
    
    watchlist = ["MAZDOCK.NS", "HAL.NS", "RVNL.NS", "SUZLON.NS", "IREDA.NS", 
                 "BEML.NS", "MTARTECH.NS", "KPITTECH.NS", "GRAVITA.NS"]
    
    message = f"🚀 <b>Daily Multi-Bagger Scan</b> - {datetime.now().strftime('%d %b %Y')}\n\n"
    count = 0
    
    for ticker in watchlist:
        try:
            info = collector.get_stock_info(ticker)
            if not info:
                continue
                
            analysis = analyzer.analyze(ticker, news)
            if "error" in analysis:
                continue
                
            analysis["final_score"] = calculate_final_score(analysis)
            
            if analysis["final_score"] >= MIN_CONVICTION_SCORE:
                count += 1
                message += f"🔥 <b>{ticker}</b> | Score: {analysis['final_score']}/10 | {analysis.get('potential_multiplier', 'N/A')}\n"
                message += f"{analysis.get('investment_thesis', 'No thesis available')[:220]}...\n\n"
        except:
            continue
    
    if count == 0:
        message += "No high-conviction ideas today. Market is quiet."
    
    # Send Telegram Message
    import requests
    url = f"https://api.telegram.org/bot{os.getenv('TELEGRAM_TOKEN')}/sendMessage"
    payload = {
        "chat_id": os.getenv("TELEGRAM_CHAT_ID"),
        "text": message,
        "parse_mode": "HTML"
    }
    requests.post(url, data=payload)
    print(f"Scan completed. {count} signals sent.")

asyncio.run(main())
