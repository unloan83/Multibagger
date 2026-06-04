import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from core.analyzer import MultiBaggerAnalyzer
from core.scorer import calculate_final_score
import plotly.express as px

class MultiBaggerBacktester:
    def __init__(self):
        self.analyzer = MultiBaggerAnalyzer()
        self.initial_capital = 100000  # ₹1 Lakh
        self.commission = 0.005  # 0.5% brokerage + taxes approx

    def generate_historical_signals(self, tickers, start_date, end_date, theme="multi_bagger"):
        """
        Reconstruct historical signals using the same logic
        """
        signals = []
        collector = IndiaDataCollector()  # Reuse from previous file
        
        date_range = pd.date_range(start_date, end_date, freq='ME')  # Monthly signals
        
        for test_date in date_range:
            # Simulate context (in real system you would archive news)
            news = collector.get_india_news(theme)
            
            for ticker in tickers:
                info = collector.get_stock_info(ticker)
                if not info:
                    continue
                
                analysis = self.analyzer.analyze(ticker, news)
                if 'error' in analysis:
                    continue
                    
                analysis['final_score'] = calculate_final_score(analysis)
                analysis['signal_date'] = test_date
                analysis['actual_date'] = test_date
                
                if analysis['final_score'] >= 7.5:
                    signals.append(analysis)
        
        return pd.DataFrame(signals)

    def run_backtest(self, signals_df, holding_period_months=36):
        """
        Run backtest on generated signals
        """
        if signals_df.empty:
            return {"error": "No signals generated"}
        
        results = []
        portfolio = []
        capital = self.initial_capital
        positions = {}
        
        for _, signal in signals_df.iterrows():
            ticker = signal['ticker']
            entry_date = signal['signal_date']
            entry_price = self._get_price_at_date(ticker, entry_date)
            
            if entry_price is None:
                continue
            
            # Simulate holding for N months
            exit_date = entry_date + timedelta(days=holding_period_months * 30)
            exit_price = self._get_price_at_date(ticker, exit_date)
            
            if exit_price is None:
                exit_price = self._get_price_at_date(ticker, datetime.now())  # Use latest if not reached
            
            shares = int((capital * 0.2) / entry_price)  # 20% allocation per idea
            entry_value = shares * entry_price
            exit_value = shares * exit_price
            
            # Commission
            entry_value *= (1 + self.commission)
            exit_value *= (1 - self.commission)
            
            pnl = exit_value - entry_value
            pnl_pct = (pnl / entry_value) * 100
            
            results.append({
                'ticker': ticker,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'entry_price': entry_price,
                'exit_price': exit_price,
                'pnl_pct': round(pnl_pct, 2),
                'conviction_score': signal['final_score'],
                'multiplier': exit_price / entry_price
            })
            
            capital += pnl
            portfolio.append({'date': exit_date, 'capital': capital})
        
        results_df = pd.DataFrame(results)
        portfolio_df = pd.DataFrame(portfolio)
        
        # Performance Metrics
        total_return = (capital / self.initial_capital - 1) * 100
        win_rate = len(results_df[results_df['pnl_pct'] > 0]) / len(results_df) * 100 if len(results_df) > 0 else 0
        
        metrics = {
            'total_return_pct': round(total_return, 2),
            'cagr_pct': self._calculate_cagr(total_return, holding_period_months),
            'win_rate_pct': round(win_rate, 2),
            'max_multiplier': round(results_df['multiplier'].max(), 2) if not results_df.empty else 0,
            'avg_multiplier': round(results_df['multiplier'].mean(), 2) if not results_df.empty else 0,
            'num_trades': len(results_df),
            'final_capital': round(capital, 2)
        }
        
        return {
            'trades': results_df,
            'portfolio': portfolio_df,
            'metrics': metrics
        }

    def _get_price_at_date(self, ticker, date):
        """Get adjusted close price at or nearest to date"""
        try:
            stock = yf.Ticker(ticker if ticker.endswith('.NS') else ticker + '.NS')
            hist = stock.history(start=date - timedelta(days=30), end=date + timedelta(days=30))
            if hist.empty:
                return None
            return hist['Close'].iloc[-1]  # Last available price near date
        except:
            return None

    def _calculate_cagr(self, total_return_pct, months):
        years = months / 12
        if years <= 0:
            return 0
        return round(((1 + total_return_pct/100) ** (1/years) - 1) * 100, 2)

    def plot_portfolio(self, portfolio_df):
        """Return Plotly chart"""
        if portfolio_df.empty:
            return None
        fig = px.line(portfolio_df, x='date', y='capital', 
                     title="Portfolio Growth Over Time (Backtest)",
                     labels={'capital': 'Portfolio Value (₹)'})
        return fig
