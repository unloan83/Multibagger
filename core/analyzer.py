import yfinance as yf
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langchain_openai import ChatOpenAI
import pandas as pd
from datetime import datetime
import json
import os

class MultiBaggerAnalyzer:
    def __init__(self, llm=None):
        self.llm = llm or self._get_default_llm()
        
        self.multi_bagger_prompt = PromptTemplate.from_template("""
        You are an expert Indian multi-bagger stock analyst specializing in aggressive small-cap investments (under ₹10,000 Cr market cap).

        Company: {company_name} ({ticker})
        Current Market Cap: ₹{market_cap_cr} Cr
        Sector/Industry: {sector}
        Current Price: ₹{current_price}
        52-Week High/Low: ₹{high_52w} / ₹{low_52w}
        
        Key Context from News, Trends & Social Sentiment:
        {context}

        India-specific factors to consider:
        - Government policies (PLI, Make in India, Atmanirbhar Bharat)
        - Sector tailwinds (Defence, EV, Semiconductors, Renewable, Pharma, etc.)
        - Management quality & promoter holding
        - Order book / Revenue visibility
        - Competitive moat (technology, patents, distribution)
        - Risks (high debt, regulatory, execution)

        Evaluate **multi-bagger potential** (5x to 50x in 3-7 years).

        Return your analysis in this exact JSON format:
        {{
            "conviction_score": X,
            "potential_multiplier": "5x-10x" or "10x-20x" or "20x+",
            "key_strengths": ["point1", "point2", "point3"],
            "key_risks": ["risk1", "risk2"],
            "catalysts": ["catalyst1", "catalyst2"],
            "investment_thesis": "Clear 2-3 sentence thesis why this can be a multi-bagger",
            "recommendation": "Strong Buy / Buy / Watch / Avoid"
        }}
        Be brutally honest. Only high-conviction ideas should get 8+ score.
        """)

    def _get_default_llm(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable not set")
        return ChatOpenAI(model="gpt-4o-mini", api_key=api_key, temperature=0.3)

    def get_stock_fundamentals(self, ticker: str):
        """Fetch basic India stock data"""
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            
            market_cap = info.get('marketCap', 0)
            market_cap_cr = round(market_cap / 10000000, 2)
            
            return {
                "company_name": info.get('longName', ticker),
                "market_cap_cr": market_cap_cr,
                "sector": info.get('sector', 'Unknown'),
                "current_price": round(info.get('currentPrice', 0), 2),
                "high_52w": round(info.get('fiftyTwoWeekHigh', 0), 2),
                "low_52w": round(info.get('fiftyTwoWeekLow', 0), 2),
            }
        except:
            return None

    def analyze(self, ticker: str, context_docs: list):
        """Main analysis function"""
        fundamentals = self.get_stock_fundamentals(ticker)
        if not fundamentals:
            return {"error": "Could not fetch stock data"}

        context = "\n\n".join(context_docs[-15:]) if context_docs else "No recent context available."

        chain = self.multi_bagger_prompt | self.llm
        
        response = chain.invoke({
            "company_name": fundamentals["company_name"],
            "ticker": ticker,
            "market_cap_cr": fundamentals["market_cap_cr"],
            "sector": fundamentals["sector"],
            "current_price": fundamentals["current_price"],
            "high_52w": fundamentals["high_52w"],
            "low_52w": fundamentals["low_52w"],
            "context": context
        })

        try:
            result = json.loads(response.content.strip())
            result.update(fundamentals)
            result["ticker"] = ticker
            result["analyzed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
            return result
        except:
            return {"error": "Failed to parse LLM response", "raw": response.content}
