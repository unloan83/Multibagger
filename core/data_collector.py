import yfinance as yf
import requests
import feedparser
from pytrends.request import TrendReq
from bs4 import BeautifulSoup
from config import NEWS_API_KEY

class IndiaDataCollector:
    def get_india_news(self, query, max_results=20):
        """Fetch news from NewsAPI + Economic Times RSS"""
        articles = []
        
        # NewsAPI
        try:
            url = f"https://newsapi.org/v2/everything?q={query}&language=en&sortBy=publishedAt&apiKey={NEWS_API_KEY}"
            resp = requests.get(url).json()
            for article in resp.get('articles', [])[:10]:
                articles.append(f"{article['title']}: {article['description']}")
        except:
            pass
        
        # Economic Times RSS
        try:
            feed = feedparser.parse("https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms")
            for entry in feed.entries[:8]:
                articles.append(entry.title + ": " + entry.description)
        except:
            pass
            
        return articles

    def get_google_trends(self, keywords, days=90):
        """India-specific Google Trends"""
        pytrends = TrendReq(hl='en-IN', tz=360)
        pytrends.build_payload(keywords, cat=0, timeframe=f'today {days}-d', geo='IN')
        df = pytrends.interest_over_time()
        return df

    def get_stock_info(self, ticker):
        """Fetch fundamentals for .NS stocks"""
        try:
            stock = yf.Ticker(ticker if ticker.endswith('.NS') else ticker + '.NS')
            info = stock.info
            market_cap_cr = round(info.get('marketCap', 0) / 10000000, 2)
            
            if market_cap_cr > 10000 or market_cap_cr == 0:
                return None  # Filter aggressive small-cap only
                
            return {
                'ticker': ticker,
                'name': info.get('longName', ticker),
                'market_cap_cr': market_cap_cr,
                'sector': info.get('sector', 'N/A'),
                'current_price': round(info.get('currentPrice', 0), 2),
                'volume': info.get('volume', 0)
            }
        except:
            return None
