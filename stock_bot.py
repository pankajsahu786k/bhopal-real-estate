import os
import time
import warnings
from datetime import datetime, timedelta, timezone

os.environ["PYTHONWARNINGS"] = "ignore"
warnings.simplefilter("ignore")

import yfinance as yf
import feedparser
import urllib.parse
import requests
from google import genai

# ================= CONFIGURATION =================
def get_env_key():
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("GEMINI_API_KEY="):
                    return line.strip().split("=", 1)[1].strip('"\'')
    return os.environ.get("GEMINI_API_KEY", "")

GEMINI_API_KEY = get_env_key()
WHATSAPP_WEBHOOK_URL = "https://bhopal-real-estate.onrender.com/api/stock-alert"

# 🔒 EXCLUSIVE ADMIN ALERT NUMBER
TARGET_PHONE = "919399115595"

# ⏰ Full Report Timings (IST)
ALERT_TIMES_IST = ["09:30", "11:30", "13:30", "15:00"]

WATCHLIST = {
    "BEL.NS": "Bharat Electronics",
    "ICICIBANK.NS": "ICICI Bank",
    "TCS.NS": "TCS Tata Consultancy Services",
    "INFY.NS": "Infosys"
}

FNO_INDICES = {
    "^NSEI": {"name": "NIFTY 50", "step": 50, "sl_pts": 40, "t1_pts": 80, "t2_pts": 130},
    "^NSEBANK": {"name": "BANK NIFTY", "step": 100, "sl_pts": 100, "t1_pts": 200, "t2_pts": 320}
}
# =================================================

client = genai.Client(api_key=GEMINI_API_KEY)
alerted_opportunities_today = set()

def get_ist_now():
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)

def calculate_rsi(series, period=14):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    return round(float(val), 2) if not (val != val) else 50.0

def get_fno_15m_analysis(symbol, meta):
    """Nifty & BankNifty 15-Minute Chart RSI + 9/21 EMA Breakout Analyzer"""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ticker = yf.Ticker(symbol)
            df = ticker.history(period="5d", interval="15m", timeout=10)

        if df.empty or len(df) < 25:
            return None

        closes = df['Close']
        highs = df['High']
        lows = df['Low']

        spot = round(float(closes.iloc[-1]), 2)
        prev_candle_high = round(float(highs.iloc[-2]), 2)
        prev_candle_low = round(float(lows.iloc[-2]), 2)

        ema9 = round(float(closes.ewm(span=9, adjust=False).mean().iloc[-1]), 2)
        ema21 = round(float(closes.ewm(span=21, adjust=False).mean().iloc[-1]), 2)
        rsi = calculate_rsi(closes, 14)

        step = meta["step"]
        atm_strike = int(round(spot / step) * step)

        signal = "NO TRADE (SIDEWAYS)"
        option_pick = "WAIT"
        sl = 0
        t1 = 0
        t2 = 0
        is_jackpot = False

        # 🟢 BULLISH CALL (CE) SETUP
        if spot > ema9 and ema9 > ema21 and 56 <= rsi <= 76:
            signal = "BUY CALL (CE) - BULLISH BREAKOUT"
            option_pick = f"{atm_strike} CE"
            sl = round(spot - meta["sl_pts"], 2)
            t1 = round(spot + meta["t1_pts"], 2)
            t2 = round(spot + meta["t2_pts"], 2)
            if spot > prev_candle_high and rsi >= 60:
                is_jackpot = True

        # 🔴 BEARISH PUT (PE) SETUP
        elif spot < ema9 and ema9 < ema21 and 24 <= rsi <= 44:
            signal = "BUY PUT (PE) - BEARISH BREAKDOWN"
            option_pick = f"{atm_strike} PE"
            sl = round(spot + meta["sl_pts"], 2)
            t1 = round(spot - meta["t1_pts"], 2)
            t2 = round(spot - meta["t2_pts"], 2)
            if spot < prev_candle_low and rsi <= 40:
                is_jackpot = True

        return {
            "symbol": symbol,
            "name": meta["name"],
            "spot": spot,
            "ema9": ema9,
            "ema21": ema21,
            "rsi": rsi,
            "signal": signal,
            "option_pick": option_pick,
            "sl": sl,
            "t1": t1,
            "t2": t2,
            "is_jackpot": is_jackpot
        }
    except Exception as e:
        print(f"   ⚠️ F&O {symbol} chart error: {e}")
        return None

def get_stock_data(symbol):
    """Stock Live Price + 15m RSI & Volume Surge Check"""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ticker = yf.Ticker(symbol)
            daily_df = ticker.history(period="5d", interval="1d", timeout=10)
            intra_df = ticker.history(period="5d", interval="15m", timeout=10)
            
        if daily_df.empty or len(daily_df) < 2:
            return None

        latest = daily_df.iloc[-1]
        prev_close = round(float(daily_df.iloc[-2]['Close']), 2)
        live_price = round(float(latest['Close']), 2)
        morning_high = round(float(latest['High']), 2)
        change_pct = round(((live_price - prev_close) / prev_close) * 100, 2)

        rsi_15m = 50.0
        ema9_15m = live_price
        if not intra_df.empty and len(intra_df) >= 15:
            rsi_15m = calculate_rsi(intra_df['Close'], 14)
            ema9_15m = round(float(intra_df['Close'].ewm(span=9, adjust=False).mean().iloc[-1]), 2)

        return {
            "price": live_price,
            "prev_close": prev_close,
            "change_pct": change_pct,
            "morning_high": morning_high,
            "rsi_15m": rsi_15m,
            "ema9_15m": ema9_15m
        }
    except Exception as e:
        print(f"   ⚠️ {symbol} data error: {e}")
        return None

def get_latest_news(company_name):
    try:
        query = urllib.parse.quote(f"{company_name} stock news India")
        rss_url = f"https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
        resp = requests.get(rss_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        feed = feedparser.parse(resp.content)
        headlines = [entry.title for entry in feed.entries[:3]]
        return headlines if headlines else ["No major news today."]
    except Exception:
        return ["No major news today."]

def generate_smart_rule_report(stocks_list, fno_list):
    negative_words = ["fall", "drop", "loss", "crash", "down", "weak", "slump", "fraud", "penalty", "sell", "bear", "low"]
    report_lines = ["📊 *AI SWING & F&O 15M CHART RADAR*\n"]

    # 1. F&O Section
    report_lines.append("⚡ *F&O 15-MIN CHART SIGNALS*")
    for f in fno_list:
        report_lines.append(f"📈 *{f['name']}* (Spot: ₹{f['spot']})")
        report_lines.append(f"📊 15m RSI: {f['rsi']} | 9-EMA: {f['ema9']} | 21-EMA: {f['ema21']}")
        if f["option_pick"] != "WAIT":
            report_lines.append(f"🔥 *Signal: {f['signal']}*")
            report_lines.append(f"🎯 *Strike:* *{f['option_pick']}* (Spot Entry: ₹{f['spot']})")
            report_lines.append(f"🛑 Spot SL: ₹{f['sl']} | 🚀 T1: ₹{f['t1']} | 🔥 T2: ₹{f['t2']}")
        else:
            report_lines.append("⏳ *Signal: NO TRADE (Wait for EMA/RSI Breakout)*")
        report_lines.append("-" * 30)

    # 2. Swing Stocks Section
    report_lines.append("\n🏢 *SWING STOCKS RADAR*")
    for item in stocks_list:
        name = item["name"]
        symbol = item["symbol"]
        price = item["price"]
        change = item["change_pct"]
        rsi = item["rsi_15m"]
        news_list = item["news"]
        has_bad_news = any(w in " ".join(news_list).lower() for w in negative_words)

        report_lines.append(f"🏢 *{name} ({symbol})*")
        report_lines.append(f"💰 Live: ₹{price} ({change}%) | 15m RSI: {rsi}")
        report_lines.append(f"📰 News: {news_list[0]}")

        if change > 0 and rsi >= 52 and not has_bad_news:
            sl = round(price * 0.97, 2)
            t1 = round(price * 1.06, 2)
            t2 = round(price * 1.10, 2)
            report_lines.append("✅ *Signal: PAPER BUY*")
            report_lines.append(f"🎯 Entry: ₹{price} | 🛑 SL (-3%): ₹{sl}")
            report_lines.append(f"🚀 T1 (+6%): ₹{t1} | 🔥 T2 (+10%): ₹{t2}")
        else:
            reason = "Price Negative/Weak RSI" if change <= 0 or rsi < 52 else "News sentiment mixed/negative"
            report_lines.append(f"⏳ *Signal: NO ENTRY (WAIT)* — ({reason})")
        report_lines.append("-" * 30)

    return "\n".join(report_lines)

def analyze_with_gemini(stock_summary, stocks_list, fno_list):
    prompt = f"""
    Tum ek strict Indian Stock Market & F&O Technical Chart Analyst ho.
    Neeche F&O 15-Minute Chart Indicators (RSI, 9/21 EMA) aur Swing Stocks ka live data + news hai:
    
    {stock_summary}
    
    Rules:
    1. Pehle '⚡ F&O 15-MIN CHART PREDICTION' section likho (Nifty 50 aur Bank Nifty ke liye).
       - Agar Spot > 9EMA > 21EMA aur RSI > 56 hai toh ATM CALL (CE) Buy signal do, warna Spot < 9EMA < 21EMA aur RSI < 44 hai toh ATM PUT (PE) Buy signal do. Sideways hone par 'WAIT / NO TRADE' bolo.
       - Spot Entry, Spot SL aur Spot Target 1 & 2 saaf likho.
    2. Phir '🏢 SWING STOCKS RADAR' section likho:
       - Sirf positive price, 15m RSI > 52 aur positive news wale stock ko 'PAPER BUY' bolo (Entry, -3% SL, +6% T1, +10% T2 ke saath). Baaki ko 'NO ENTRY (WAIT)' bolo.
    Hinglish mein short WhatsApp format mein likho.
    """

    try:
        print("🤖 AI Report generate ho rahi hai (gemini-flash-latest)...")
        response = client.models.generate_content(model="gemini-flash-latest", contents=prompt)
        if response and response.text:
            return response.text
    except Exception as e:
        print(f"   ⚠️ gemini-flash-latest error: {str(e)[:100]}")

    return generate_smart_rule_report(stocks_list, fno_list)

def send_whatsapp_alert(message):
    try:
        res = requests.post(
            WHATSAPP_WEBHOOK_URL,
            json={"phone": TARGET_PHONE, "adminPhone": TARGET_PHONE, "message": message},
            timeout=15
        )
        if res.status_code == 200:
            print(f"✅ Alert seedha Authorized WhatsApp ({TARGET_PHONE}) par bhej diya gaya!")
        else:
            print(f"⚠️ Server response: {res.status_code}")
    except Exception as e:
        print(f"⚠️ WhatsApp Webhook Error: {e}")

def run_scanner(only_live_opportunity=False):
    global alerted_opportunities_today
    now_ist = get_ist_now()
    today_str = now_ist.strftime("%Y-%m-%d")

    print(f"🚀 [{'Opportunity Radar' if only_live_opportunity else 'Full Market Scan'}] Scanning F&O 15m Charts & Stocks...")
    summary_text = "=== F&O 15-MINUTE CHART DATA ===\n"
    fno_list = []
    stocks_list = []
    live_opportunities = []

    # 1. Scan F&O 15m Charts
    for symbol, meta in FNO_INDICES.items():
        fno_data = get_fno_15m_analysis(symbol, meta)
        if fno_data:
            fno_list.append(fno_data)
            summary_text += f"\nIndex: {fno_data['name']} ({symbol})\nSpot: ₹{fno_data['spot']} | 15m RSI: {fno_data['rsi']} | 9EMA: {fno_data['ema9']} | 21EMA: {fno_data['ema21']}\nAuto Signal: {fno_data['signal']} | Strike: {fno_data['option_pick']} | SL: {fno_data['sl']} | T1: {fno_data['t1']} | T2: {fno_data['t2']}\n"

            opp_key = f"{today_str}_{symbol}_{fno_data['option_pick']}"
            if fno_data["is_jackpot"] and opp_key not in alerted_opportunities_today:
                alerted_opportunities_today.add(opp_key)
                live_opportunities.append(
                    f"🔥 *F&O 15M BREAKOUT: {fno_data['name']}*\n"
                    f"📈 *Action:* *{fno_data['signal']}*\n"
                    f"🎯 *Option Strike:* *{fno_data['option_pick']}*\n"
                    f"💰 *Spot Entry:* ₹{fno_data['spot']} (RSI: {fno_data['rsi']})\n"
                    f"🛑 *Spot SL:* ₹{fno_data['sl']} | 🚀 *Target 1:* ₹{fno_data['t1']} | 🔥 *Target 2:* ₹{fno_data['t2']}"
                )

    summary_text += "\n=== SWING STOCKS DATA ===\n"
    negative_words = ["fall", "drop", "loss", "crash", "down", "weak", "slump", "fraud", "penalty", "sell"]

    # 2. Scan Watchlist Stocks
    for symbol, name in WATCHLIST.items():
        data = get_stock_data(symbol)
        news = get_latest_news(name)
        if data:
            stocks_list.append({"symbol": symbol, "name": name, **data, "news": news})
            summary_text += f"\nStock: {name} ({symbol})\nLive: ₹{data['price']} ({data['change_pct']}%) | 15m RSI: {data['rsi_15m']} | Day High: ₹{data['morning_high']}\nNews: {' | '.join(news)}\n"

            has_bad_news = any(w in " ".join(news).lower() for w in negative_words)
            opp_key = f"{today_str}_{symbol}_BUY"
            if data["change_pct"] >= 1.2 and data["rsi_15m"] >= 58 and data["price"] >= data["ema9_15m"] and not has_bad_news and opp_key not in alerted_opportunities_today:
                alerted_opportunities_today.add(opp_key)
                live_opportunities.append(
                    f"🚀 *STRONG STOCK BREAKOUT: {name} ({symbol})*\n"
                    f"💰 *Live Price:* ₹{data['price']} (+{data['change_pct']}%) | *15m RSI:* {data['rsi_15m']}\n"
                    f"📰 *News:* {news[0]}\n"
                    f"🎯 *Buy Entry:* ₹{data['price']} | 🛑 *SL (-3%):* ₹{round(data['price']*0.97, 2)}\n"
                    f"🚀 *T1 (+6%):* ₹{round(data['price']*1.06, 2)} | 🔥 *T2 (+10%):* ₹{round(data['price']*1.10, 2)}"
                )

    # Agar sirf 15-min Opportunity Radar mode hai
    if only_live_opportunity:
        if live_opportunities:
            alert_msg = "🚨 *LIVE MARKET OPPORTUNITY ALERT* 🚨\n_(High-Momentum 15m Chart Breakout Detected!)_\n\n" + "\n\n----------------------------\n\n".join(live_opportunities)
            print("\n" + alert_msg + "\n")
            send_whatsapp_alert(alert_msg)
        else:
            print("   ℹ️ Abhi koi naya extreme breakout nahi hai. Waiting for next 15m candle...")
        return

    # Full Scheduled Report
    if not stocks_list and not fno_list:
        return

    final_report = analyze_with_gemini(summary_text, stocks_list, fno_list)
    print("\n================ AI F&O + SWING REPORT ================\n")
    print(final_report)
    print("\n=======================================================\n")
    send_whatsapp_alert(final_report)

def start_timed_bot():
    print(f"⏰ F&O + Swing Bot Active! Authorized Admin Number: {TARGET_PHONE}")
    run_scanner(only_live_opportunity=False)
    last_sent_slot = ""
    last_radar_min = -1

    while True:
        now_ist = get_ist_now()
        current_hm = now_ist.strftime("%H:%M")
        date_slot_key = f"{now_ist.strftime('%Y-%m-%d')}_{current_hm}"

        if now_ist.weekday() < 5:
            # 1. Fixed Time Full Report (09:30, 11:30, 13:30, 15:00)
            if current_hm in ALERT_TIMES_IST and last_sent_slot != date_slot_key:
                last_sent_slot = date_slot_key
                run_scanner(only_live_opportunity=False)

            # 2. Every 15-Min Live Opportunity Radar during Market Hours (9:15 AM - 3:15 PM)
            market_open = now_ist.replace(hour=9, minute=15, second=0)
            market_close = now_ist.replace(hour=15, minute=15, second=0)
            if market_open <= now_ist <= market_close and now_ist.minute in [0, 15, 30, 45] and last_radar_min != now_ist.minute:
                last_radar_min = now_ist.minute
                if current_hm not in ALERT_TIMES_IST:
                    run_scanner(only_live_opportunity=True)

        time.sleep(20)

if __name__ == "__main__":
    start_timed_bot()