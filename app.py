"""
StockLens — Company & Market Intelligence Dashboard
-----------------------------------------------------
Flask backend. Pulls real company/financial data via yfinance and
computes a transparent, honestly-labeled statistical price projection
(NOT a guaranteed prediction — see /api/forecast for methodology).
"""

from flask import Flask, jsonify, render_template, request
import yfinance as yf
import numpy as np
import pandas as pd
from datetime import datetime
import traceback

app = Flask(__name__)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def clean(obj):
    """Recursively replace NaN/inf/NaT with None so JSON encoding never breaks."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean(v) for v in obj]
    if isinstance(obj, (float, np.floating)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.strftime("%Y-%m-%d")
    if pd.isna(obj) if not isinstance(obj, (list, dict)) else False:
        return None
    return obj


def get_ticker(symbol):
    return yf.Ticker(symbol.upper().strip())


# --------------------------------------------------------------------------
# Routes — pages
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------
# API — company profile
# --------------------------------------------------------------------------

@app.route("/api/company/<symbol>")
def company(symbol):
    try:
        t = get_ticker(symbol)
        info = t.info or {}

        if not info or info.get("regularMarketPrice") is None and info.get("currentPrice") is None:
            # Some tickers still return partial info; only fail if truly empty
            if len(info) < 3:
                return jsonify({"error": f"No data found for '{symbol}'. Check the ticker symbol."}), 404

        price = info.get("currentPrice") or info.get("regularMarketPrice")
        prev_close = info.get("previousClose")
        change = None
        change_pct = None
        if price is not None and prev_close:
            change = price - prev_close
            change_pct = (change / prev_close) * 100

        payload = {
            "symbol": symbol.upper(),
            "name": info.get("longName") or info.get("shortName") or symbol.upper(),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "country": info.get("country"),
            "website": info.get("website"),
            "summary": info.get("longBusinessSummary"),
            "employees": info.get("fullTimeEmployees"),
            "exchange": info.get("exchange"),
            "currency": info.get("currency"),
            "price": price,
            "previousClose": prev_close,
            "change": change,
            "changePercent": change_pct,
            "dayHigh": info.get("dayHigh"),
            "dayLow": info.get("dayLow"),
            "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
            "marketCap": info.get("marketCap"),
            "peRatio": info.get("trailingPE"),
            "forwardPE": info.get("forwardPE"),
            "eps": info.get("trailingEps"),
            "dividendYield": info.get("dividendYield"),
            "beta": info.get("beta"),
            "profitMargins": info.get("profitMargins"),
            "grossMargins": info.get("grossMargins"),
            "operatingMargins": info.get("operatingMargins"),
            "returnOnEquity": info.get("returnOnEquity"),
            "returnOnAssets": info.get("returnOnAssets"),
            "debtToEquity": info.get("debtToEquity"),
            "currentRatio": info.get("currentRatio"),
            "revenueGrowth": info.get("revenueGrowth"),
            "earningsGrowth": info.get("earningsGrowth"),
            "totalRevenue": info.get("totalRevenue"),
            "grossProfits": info.get("grossProfits"),
            "freeCashflow": info.get("freeCashflow"),
            "totalCash": info.get("totalCash"),
            "totalDebt": info.get("totalDebt"),
            "recommendationKey": info.get("recommendationKey"),
            "targetMeanPrice": info.get("targetMeanPrice"),
            "numberOfAnalystOpinions": info.get("numberOfAnalystOpinions"),
        }
        return jsonify(clean(payload))
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# --------------------------------------------------------------------------
# API — price history
# --------------------------------------------------------------------------

@app.route("/api/history/<symbol>")
def history(symbol):
    rng = request.args.get("range", "5y")
    try:
        t = get_ticker(symbol)
        hist = t.history(period=rng, auto_adjust=True)
        if hist.empty:
            return jsonify({"error": "No historical data available."}), 404

        hist = hist.reset_index()
        date_col = "Date" if "Date" in hist.columns else hist.columns[0]

        # 50 & 200 day simple moving averages
        hist["SMA50"] = hist["Close"].rolling(50).mean()
        hist["SMA200"] = hist["Close"].rolling(200).mean()

        # RSI (14-day)
        delta = hist["Close"].diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss
        hist["RSI"] = 100 - (100 / (1 + rs))

        data = {
            "dates": [d.strftime("%Y-%m-%d") for d in hist[date_col]],
            "open": hist["Open"].round(2).tolist(),
            "high": hist["High"].round(2).tolist(),
            "low": hist["Low"].round(2).tolist(),
            "close": hist["Close"].round(2).tolist(),
            "volume": hist["Volume"].tolist(),
            "sma50": hist["SMA50"].round(2).tolist(),
            "sma200": hist["SMA200"].round(2).tolist(),
            "rsi": hist["RSI"].round(2).tolist(),
            "listedSince": hist[date_col].iloc[0].strftime("%Y-%m-%d"),
        }
        return jsonify(clean(data))
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# --------------------------------------------------------------------------
# API — financial statements
# --------------------------------------------------------------------------

@app.route("/api/financials/<symbol>")
def financials(symbol):
    try:
        t = get_ticker(symbol)

        def frame_to_series(df, rows):
            """Pull selected rows from a yfinance statement DataFrame -> {label: {year: value}}"""
            out = {}
            if df is None or df.empty:
                return out
            cols = [c.strftime("%Y") if hasattr(c, "strftime") else str(c) for c in df.columns]
            for row_label in rows:
                if row_label in df.index:
                    vals = df.loc[row_label].tolist()
                    out[row_label] = dict(zip(cols, vals))
            return out

        income = t.financials
        balance = t.balance_sheet
        cashflow = t.cashflow

        income_rows = ["Total Revenue", "Gross Profit", "Operating Income",
                        "Net Income", "EBITDA", "Research And Development"]
        balance_rows = ["Total Assets", "Total Liabilities Net Minority Interest",
                         "Total Equity Gross Minority Interest", "Cash And Cash Equivalents",
                         "Total Debt"]
        cashflow_rows = ["Operating Cash Flow", "Free Cash Flow",
                          "Capital Expenditure", "Repurchase Of Capital Stock"]

        payload = {
            "income": frame_to_series(income, income_rows),
            "balance": frame_to_series(balance, balance_rows),
            "cashflow": frame_to_series(cashflow, cashflow_rows),
        }
        return jsonify(clean(payload))
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# --------------------------------------------------------------------------
# API — macro context (rates, dollar index — factors that move stocks)
# --------------------------------------------------------------------------

@app.route("/api/macro")
def macro():
    try:
        symbols = {
            "10Y Treasury Yield": "^TNX",
            "US Dollar Index": "DX-Y.NYB",
            "VIX (Volatility Index)": "^VIX",
            "S&P 500": "^GSPC",
        }
        out = {}
        for label, sym in symbols.items():
            try:
                h = yf.Ticker(sym).history(period="5d")
                if not h.empty:
                    last = h["Close"].iloc[-1]
                    prev = h["Close"].iloc[-2] if len(h) > 1 else last
                    out[label] = {
                        "value": round(float(last), 2),
                        "changePercent": round(float((last - prev) / prev * 100), 2),
                    }
            except Exception:
                continue
        return jsonify(clean(out))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --------------------------------------------------------------------------
# API — forecast (transparent statistical projection, NOT a guarantee)
# --------------------------------------------------------------------------

@app.route("/api/forecast/<symbol>")
def forecast(symbol):
    """
    Methodology (shown to the user in the UI — never hidden):
    1. Pull 2 years of daily close prices.
    2. Compute daily log returns; drift = mean, volatility = std dev.
    3. Project forward using Geometric Brownian Motion: this is the same
       basic model options-pricing (Black-Scholes) rests on. It assumes
       the future resembles the recent past — a real assumption that
       often breaks, especially around news/earnings/macro shocks.
    4. Confidence bands (68% / 95%) come from the volatility term, not
       from any special predictive insight into direction.
    This is a statistical extrapolation, not a prediction of what will
    actually happen. Markets are heavily influenced by information that
    hasn't occurred yet, which no historical model can see.
    """
    horizon = int(request.args.get("days", 90))
    try:
        t = get_ticker(symbol)
        hist = t.history(period="2y", auto_adjust=True)
        if hist.empty or len(hist) < 60:
            return jsonify({"error": "Not enough history to forecast."}), 404

        close = hist["Close"].dropna()
        log_returns = np.log(close / close.shift(1)).dropna()

        mu = log_returns.mean()
        sigma = log_returns.std()
        last_price = float(close.iloc[-1])
        last_date = close.index[-1]

        days = np.arange(1, horizon + 1)
        drift_path = last_price * np.exp(mu * days)
        vol_1sigma = last_price * np.exp(mu * days) * (sigma * np.sqrt(days))
        vol_2sigma = vol_1sigma * 2

        future_dates = pd.bdate_range(last_date + pd.Timedelta(days=1), periods=horizon)

        payload = {
            "lastPrice": round(last_price, 2),
            "lastDate": last_date.strftime("%Y-%m-%d"),
            "dates": [d.strftime("%Y-%m-%d") for d in future_dates],
            "projected": np.round(drift_path, 2).tolist(),
            "upper68": np.round(drift_path + vol_1sigma, 2).tolist(),
            "lower68": np.round(np.maximum(drift_path - vol_1sigma, 0), 2).tolist(),
            "upper95": np.round(drift_path + vol_2sigma, 2).tolist(),
            "lower95": np.round(np.maximum(drift_path - vol_2sigma, 0), 2).tolist(),
            "annualizedDriftPct": round(float(mu * 252 * 100), 2),
            "annualizedVolatilityPct": round(float(sigma * np.sqrt(252) * 100), 2),
            "methodology": (
                "Geometric Brownian Motion projection from 2 years of historical "
                "daily returns. Drift and volatility are estimated from the past "
                "and assumed to continue — a simplifying assumption, not a fact "
                "about the future. This is a statistical extrapolation, not a "
                "prediction. Widening shaded bands show growing uncertainty over "
                "time, not a shrinking one."
            ),
        }
        return jsonify(clean(payload))
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"
    app.run(debug=debug, host="0.0.0.0", port=port)
