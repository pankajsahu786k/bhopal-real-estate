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
SERVER_BASE_URL = "https://bhopal-real-estate.onrender.com"
WHATSAPP_WEBHOOK_URL = f"{SERVER_BASE_URL}/api/stock-alert"
WALLET_API_URL = f"{SERVER_BASE_URL}/api/ai-agent/wallet"

# 🔒 EXCLUSIVE ADMIN ALERT NUMBER & ₹10,000 AI BUDGET
TARGET_PHONE = "919399115595"
INITIAL_AI_BUDGET = 10000
MAX_PER_STOCK_BUDGET = 5000

# ⏰ Full Report Timings (IST)
ALERT_TIMES_IST = ["09:30", "11:30", "13:30", "15:00"]

WATCHLIST = {
    "BEL.NS": "Bharat Electronics",
    "ICICIBANK.NS": "ICICI Bank",
    "TCS.NS": "TCS Tata Consultancy Services",
    "INFY.NS": "Infosys"
}

FNO_INDICES = {
    "^NSEI": {
        "name": "NIFTY 50 (Weekly)",
        "tv_sym": "NSE:NIFTY",
        "step": 50,
        "lot_size": 75,
        "sl_pts": 40,
        "t1_pts": 80,
        "t2_pts": 130,
        "base_prem_pct": 0.0075
    },
    "^NSEBANK": {
        "name": "BANK NIFTY (Monthly)",
        "tv_sym": "NSE:BANKNIFTY",
        "step": 100,
        "lot_size": 30,
        "sl_pts": 100,
        "t1_pts": 200,
        "t2_pts": 320,
        "base_prem_pct": 0.0122
    }
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

def detect_candle_pattern(opens, highs, lows, closes, ema9, ema21, vwap):
    """15-Min Candlestick Pattern & Breakout Detector"""
    o, h, l, c = float(opens.iloc[-1]), float(highs.iloc[-1]), float(lows.iloc[-1]), float(closes.iloc[-1])
    po, ph, pl, pc = float(opens.iloc[-2]), float(highs.iloc[-2]), float(lows.iloc[-2]), float(closes.iloc[-2])

    body = abs(c - o)
    total_range = max(0.1, h - l)
    lower_wick = min(o, c) - l
    upper_wick = h - max(o, c)

    patterns = []
    if c > o and pc < po and c > po and o <= pc:
        patterns.append("Bullish Engulfing")
    elif c > o and body >= total_range * 0.75:
        patterns.append("Strong Bullish Marubozu")
    elif lower_wick >= body * 2 and upper_wick <= body * 0.5:
        patterns.append("Bullish Hammer Bounce")
    elif c < o and pc > po and c < po and o >= pc:
        patterns.append("Bearish Engulfing")
    elif c < o and body >= total_range * 0.75:
        patterns.append("Strong Bearish Marubozu")
    elif upper_wick >= body * 2 and lower_wick <= body * 0.5:
        patterns.append("Shooting Star Rejection")

    if c > ph:
        patterns.append(f"Prev 15m High (₹{round(ph, 1)}) Breakout")
    elif c < pl:
        patterns.append(f"Prev 15m Low (₹{round(pl, 1)}) Breakdown")

    if c > vwap and c > ema9 and ema9 > ema21:
        patterns.append("Above VWAP + 9/21 EMA")
    elif c < vwap and c < ema9 and ema9 < ema21:
        patterns.append("Below VWAP + 9/21 EMA")

    return " + ".join(patterns) if patterns else "15m Range Consolidation"

def fetch_cloud_wallet():
    """Fetch Live ₹10,000 AI Agent Wallet from Render Server"""
    try:
        res = requests.get(WALLET_API_URL, timeout=8)
        if res.status_code == 200:
            data = res.json()
            if data.get("success") and data.get("wallet"):
                return data["wallet"]
    except Exception:
        pass
    return {
        "initialCapital": INITIAL_AI_BUDGET,
        "availableCash": INITIAL_AI_BUDGET,
        "realizedPnL": 0,
        "openPositions": []
    }

def get_fno_15m_analysis(symbol, meta):
    """High-Accuracy 15m F&O Analyzer (VWAP + Strict RSI 55-68 + Pullback Guard + Lot Calculator)"""
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
        opens = df['Open']

        spot = round(float(closes.iloc[-1]), 2)
        current_open = round(float(opens.iloc[-1]), 2)
        closed_candle = round(float(closes.iloc[-2]), 2)
        prev_candle_high = round(float(highs.iloc[-2]), 2)
        prev_candle_low = round(float(lows.iloc[-2]), 2)
        recent_high = round(float(highs.iloc[-6:].max()), 2)

        ema9 = round(float(closes.ewm(span=9, adjust=False).mean().iloc[-1]), 2)
        ema21 = round(float(closes.ewm(span=21, adjust=False).mean().iloc[-1]), 2)
        rsi = calculate_rsi(closes, 14)
        prev_rsi = calculate_rsi(closes.iloc[:-1], 14)

        typical_prices = (closes.iloc[-15:] + highs.iloc[-15:] + lows.iloc[-15:]) / 3
        vwap = round(float(typical_prices.mean()), 2)

        step = meta["step"]
        atm_strike = int(round(spot / step) * step)
        pattern_ref = detect_candle_pattern(opens, highs, lows, closes, ema9, ema21, vwap)
        chart_url = f"https://in.tradingview.com/chart/?symbol={urllib.parse.quote(meta['tv_sym'])}&interval=15"

        # Option Lot, Premium & Risk/Reward Calculation
        lot_size = meta["lot_size"]
        est_premium = int(round(spot * meta["base_prem_pct"]))
        sl_opt_pts = int(round(meta["sl_pts"] * 0.5))
        t1_opt_pts = int(round(meta["t1_pts"] * 0.5))
        capital_1lot = est_premium * lot_size
        max_risk_1lot = sl_opt_pts * lot_size
        reward_1lot = t1_opt_pts * lot_size

        is_candle_green = spot >= current_open and spot >= closed_candle
        is_candle_red = spot <= current_open and spot <= closed_candle
        is_falling_from_top = (recent_high - spot) > (meta["sl_pts"] * 0.8)

        signal = "NO TRADE (SIDEWAYS - WAIT)"
        option_pick = "WAIT"
        sl = 0
        t1 = 0
        t2 = 0
        is_jackpot = False
        conviction = "3/10"

        if rsi > 68:
            signal = f"OVERBOUGHT TRAP (RSI {rsi}) - TOP PAR BUY MAT KAREIN"
        elif rsi < 32:
            signal = f"OVERSOLD TRAP (RSI {rsi}) - BOTTOM PAR PUT MAT LEIN"
        elif spot > ema9 and is_falling_from_top:
            signal = f"PULLBACK WARNING (Top ₹{int(recent_high)} se gir raha hai - Wait karein)"
        # 🟢 HIGH-ACCURACY BULLISH CALL (CE) SETUP
        elif spot > vwap and spot > ema9 and ema9 > ema21 and is_candle_green and rsi >= prev_rsi and 55 <= rsi <= 68:
            signal = "BUY CALL (CE) - FRESH BREAKOUT"
            option_pick = f"{atm_strike} CE"
            sl = round(spot - meta["sl_pts"], 2)
            t1 = round(spot + meta["t1_pts"], 2)
            t2 = round(spot + meta["t2_pts"], 2)
            conviction = "9/10 🔥" if spot > prev_candle_high else "8/10 ✅"
            if spot > prev_candle_high and 58 <= rsi <= 66:
                is_jackpot = True
        # 🔴 HIGH-ACCURACY BEARISH PUT (PE) SETUP
        elif spot < vwap and spot < ema9 and ema9 < ema21 and is_candle_red and rsi <= prev_rsi and 32 <= rsi <= 45:
            signal = "BUY PUT (PE) - FRESH BREAKDOWN"
            option_pick = f"{atm_strike} PE"
            sl = round(spot + meta["sl_pts"], 2)
            t1 = round(spot - meta["t1_pts"], 2)
            t2 = round(spot - meta["t2_pts"], 2)
            conviction = "9/10 🔥" if spot < prev_candle_low else "8/10 ✅"
            if spot < prev_candle_low and 34 <= rsi <= 42:
                is_jackpot = True

        return {
            "symbol": symbol,
            "name": meta["name"],
            "spot": spot,
            "vwap": vwap,
            "ema9": ema9,
            "ema21": ema21,
            "rsi": rsi,
            "signal": signal,
            "option_pick": option_pick,
            "sl": sl,
            "t1": t1,
            "t2": t2,
            "is_jackpot": is_jackpot,
            "conviction": conviction,
            "lot_size": lot_size,
            "est_premium": est_premium,
            "sl_opt_pts": sl_opt_pts,
            "t1_opt_pts": t1_opt_pts,
            "capital_1lot": capital_1lot,
            "max_risk_1lot": max_risk_1lot,
            "reward_1lot": reward_1lot,
            "pattern_ref": pattern_ref,
            "chart_url": chart_url
        }
    except Exception as e:
        print(f"   ⚠️ F&O {symbol} chart error: {e}")
        return None

def get_stock_data(symbol):
    """High-Accuracy Stock Scanner (Strict RSI 54-67 + Volume Surge + Pattern + Chart URL)"""
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
        ema21_15m = live_price
        vol_surge = False
        pattern_ref = "15m Consolidation"

        if not intra_df.empty and len(intra_df) >= 25:
            closes_15m = intra_df['Close']
            rsi_15m = calculate_rsi(closes_15m, 14)
            ema9_15m = round(float(closes_15m.ewm(span=9, adjust=False).mean().iloc[-1]), 2)
            ema21_15m = round(float(closes_15m.ewm(span=21, adjust=False).mean().iloc[-1]), 2)
            vols = intra_df['Volume']
            if len(vols) >= 11:
                avg_vol = float(vols.iloc[-11:-1].mean())
                latest_vol = float(vols.iloc[-1])
                vol_surge = avg_vol > 0 and latest_vol >= (avg_vol * 1.25)
            pattern_ref = detect_candle_pattern(
                intra_df['Open'], intra_df['High'], intra_df['Low'], closes_15m, ema9_15m, ema21_15m, ema9_15m
            )

        is_high_accuracy_buy = (
            0.5 <= change_pct <= 3.5 and
            54 <= rsi_15m <= 67 and
            live_price > ema9_15m and
            ema9_15m >= ema21_15m
        )
        clean_sym = symbol.replace(".NS", "")
        chart_url = f"https://in.tradingview.com/chart/?symbol=NSE:{clean_sym}&interval=15"

        return {
            "price": live_price,
            "prev_close": prev_close,
            "change_pct": change_pct,
            "morning_high": morning_high,
            "rsi_15m": rsi_15m,
            "ema9_15m": ema9_15m,
            "ema21_15m": ema21_15m,
            "vol_surge": vol_surge,
            "is_high_accuracy_buy": is_high_accuracy_buy,
            "pattern_ref": pattern_ref,
            "chart_url": chart_url
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

def generate_smart_rule_report(stocks_list, fno_list, wallet):
    negative_words = ["fall", "drop", "loss", "crash", "down", "weak", "slump", "fraud", "penalty", "sell", "bear", "low"]
    avail_cash = wallet.get("availableCash", INITIAL_AI_BUDGET)
    realized_pnl = wallet.get("realizedPnL", 0)
    open_positions = wallet.get("openPositions", [])

    report_lines = [
        "📊 *PRO F&O & ₹10,000 AI AGENT TRADING GUIDE*",
        f"💼 *AI Wallet Cash:* ₹{avail_cash:,} | *Open Trades:* {len(open_positions)} | *Realized P&L:* ₹{realized_pnl}\n",
        "⚡ *1. F&O INTRADAY OPTION CHAIN GUIDE*"
    ]

    for f in fno_list:
        report_lines.append(f"\n📈 *{f['name']}* (Spot: ₹{f['spot']} | RSI: {f['rsi']} | VWAP: ₹{f['vwap']})")
        report_lines.append(f"📐 *Chart Pattern:* {f['pattern_ref']}")
        if f["option_pick"] != "WAIT":
            report_lines.append(f"🟢 *Signal:* *{f['signal']}* (Score: {f['conviction']})")
            report_lines.append(f"👉 *Option Chain Mein Search Karein:* *{f['name']} {f['option_pick']}*")
            report_lines.append(f"📦 *Lot Size:* 1 Lot = {f['lot_size']} Qty | *Est. Premium:* ~₹{f['est_premium']}")
            report_lines.append(f"💰 *Kul Paisa Lagega (1 Lot):* *~₹{f['capital_1lot']:,}*")
            report_lines.append(f"🎯 *SL/Target Rule:* Live Option Price se *-{f['sl_opt_pts']} pts SL* (Risk: ₹{f['max_risk_1lot']}) | *+{f['t1_opt_pts']} pts Target* (+₹{f['reward_1lot']})")
            report_lines.append(f"📍 _(Spot SL: ₹{f['sl']} | Spot T1: ₹{f['t1']})_")
        else:
            report_lines.append(f"⏳ *Action:* *{f['signal']}*")
        report_lines.append(f"🔗 *Live 15m Chart:* {f['chart_url']}")
        report_lines.append("-" * 28)

    report_lines.append("\n🏢 *2. AI AGENT SWING STOCKS (₹10,000 FUND)*")
    for item in stocks_list:
        name = item["name"]
        symbol = item["symbol"]
        price = item["price"]
        change = item["change_pct"]
        rsi = item["rsi_15m"]
        news_list = item["news"]
        has_bad_news = any(w in " ".join(news_list).lower() for w in negative_words)

        report_lines.append(f"\n🏢 *{name}* — ₹{price} ({change}% | RSI: {rsi})")
        report_lines.append(f"📐 *Chart Setup:* {item['pattern_ref']}")

        if item["is_high_accuracy_buy"] and not has_bad_news:
            qty_5k = max(1, int(MAX_PER_STOCK_BUDGET // price))
            sl = round(price * 0.97, 2)
            t1 = round(price * 1.06, 2)
            report_lines.append(f"✅ *Signal: HIGH-ACCURACY BUY ({qty_5k} Shares for ₹5,000)*")
            report_lines.append(f"🛑 *SL (-3%):* ₹{sl} | 🚀 *Target (+6%):* ₹{t1}")
        else:
            reason = f"Overbought RSI ({rsi}) - Top par mat lein" if rsi > 67 else "Waiting for 15m EMA+RSI Breakout"
            report_lines.append(f"⏳ *NO ENTRY (WAIT)* — _({reason})_")
        report_lines.append(f"🔗 *Live Chart:* {item['chart_url']}")

    report_lines.append("\n💡 _WhatsApp Commands: 'wallet' (₹10k AI Fund) | 'fno' (1.5s F&O Radar) | 'reset wallet'_")
    return "\n".join(report_lines)

def analyze_with_gemini(stock_summary, stocks_list, fno_list, wallet):
    # Deterministic High-Accuracy Report with Exact Option Lot, Capital, Pattern & Chart URLs
    base_report = generate_smart_rule_report(stocks_list, fno_list, wallet)
    if not GEMINI_API_KEY:
        return base_report

    prompt = f"""
    Act as a seasoned Indian Equity & F&O Research Analyst with 20 years of experience.
    Do not give a diplomatic answer. Review this live 15-minute technical & news data:
    {stock_summary}

    Write a 3-line '🧠 AI CHIEF ANALYST CONVICTION NOTE' in Hinglish at the top:
    - Mention which F&O index or stock has the highest conviction score out of 10 today and why.
    - Warn against any overbought RSI (>68) or pullback traps.
    Keep it under 60 words so it can be appended to our main report.
    """
    try:
        print("🤖 AI Conviction Note generate ho rahi hai (gemini-flash-latest)...")
        response = client.models.generate_content(model="gemini-flash-latest", contents=prompt)
        if response and response.text:
            return f"{base_report}\n\n🧠 *AI ANALYST NOTE:*\n{response.text.strip()}"
    except Exception as e:
        print(f"   ⚠️ gemini-flash-latest note skipped: {str(e)[:80]}")

    return base_report

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

    print(f"🚀 [{'Opportunity Radar' if only_live_opportunity else 'Full Market Scan'}] Scanning F&O 15m Charts & ₹10k AI Portfolio...")
    wallet = fetch_cloud_wallet()
    summary_text = "=== F&O 15-MINUTE CHART DATA ===\n"
    fno_list = []
    stocks_list = []
    live_opportunities = []

    # 1. Scan F&O 15m Charts
    for symbol, meta in FNO_INDICES.items():
        fno_data = get_fno_15m_analysis(symbol, meta)
        if fno_data:
            fno_list.append(fno_data)
            summary_text += (
                f"\nIndex: {fno_data['name']} | Spot: ₹{fno_data['spot']} | VWAP: ₹{fno_data['vwap']} | "
                f"15m RSI: {fno_data['rsi']} | Pattern: {fno_data['pattern_ref']} | Signal: {fno_data['signal']}\n"
            )

            opp_key = f"{today_str}_{symbol}_{fno_data['option_pick']}"
            if fno_data["is_jackpot"] and opp_key not in alerted_opportunities_today:
                alerted_opportunities_today.add(opp_key)
                live_opportunities.append(
                    f"🔥 *F&O JACKPOT BREAKOUT: {fno_data['name']}*\n"
                    f"⭐ *Accuracy Score:* {fno_data['conviction']}\n"
                    f"📐 *Pattern Match:* {fno_data['pattern_ref']}\n"
                    f"👉 *Option Chain:* *{fno_data['name']} {fno_data['option_pick']}* (1 Lot = {fno_data['lot_size']} Qty)\n"
                    f"💵 *Est. Premium:* ~₹{fno_data['est_premium']} (1 Lot Capital: ~₹{fno_data['capital_1lot']:,})\n"
                    f"🎯 *Rule:* Live Option Price se *-{fno_data['sl_opt_pts']} pts SL* aur *+{fno_data['t1_opt_pts']} pts Target* lagayein!\n"
                    f"🔗 *Live Chart:* {fno_data['chart_url']}"
                )

    summary_text += "\n=== SWING STOCKS DATA ===\n"
    negative_words = ["fall", "drop", "loss", "crash", "down", "weak", "slump", "fraud", "penalty", "sell"]

    # 2. Scan Watchlist Stocks
    for symbol, name in WATCHLIST.items():
        data = get_stock_data(symbol)
        news = get_latest_news(name)
        if data:
            stocks_list.append({"symbol": symbol, "name": name, **data, "news": news})
            summary_text += (
                f"\nStock: {name} | Live: ₹{data['price']} ({data['change_pct']}%) | "
                f"15m RSI: {data['rsi_15m']} | Pattern: {data['pattern_ref']} | News: {news[0]}\n"
            )

            has_bad_news = any(w in " ".join(news).lower() for w in negative_words)
            opp_key = f"{today_str}_{symbol}_BUY"
            if data["is_high_accuracy_buy"] and data["vol_surge"] and not has_bad_news and opp_key not in alerted_opportunities_today:
                alerted_opportunities_today.add(opp_key)
                qty_5k = max(1, int(MAX_PER_STOCK_BUDGET // data["price"]))
                live_opportunities.append(
                    f"🚀 *HIGH-ACCURACY STOCK BREAKOUT: {name}*\n"
                    f"📐 *Pattern Match:* {data['pattern_ref']}\n"
                    f"💰 *Buy Price:* ₹{data['price']} (+{data['change_pct']}%) | *15m RSI:* {data['rsi_15m']}\n"
                    f"💼 *₹5,000 Allocation:* *{qty_5k} Shares* kharidein\n"
                    f"🛑 *SL (-3%):* ₹{round(data['price']*0.97, 2)} | 🎯 *Target (+6%):* ₹{round(data['price']*1.06, 2)}\n"
                    f"🔗 *Live Chart:* {data['chart_url']}"
                )

    if only_live_opportunity:
        if live_opportunities:
            alert_msg = "🚨 *HIGH-ACCURACY TRADE ALERT* 🚨\n\n" + "\n\n━━━━━━━━━━━━━━━━━━\n\n".join(live_opportunities)
            print("\n" + alert_msg + "\n")
            send_whatsapp_alert(alert_msg)
        else:
            print("   ℹ️ Abhi koi naya confirmed breakout nahi hai. Overbought/Sideways traps skipped.")
        return

    if not stocks_list and not fno_list:
        return

    final_report = analyze_with_gemini(summary_text, stocks_list, fno_list, wallet)
    print("\n================ AI F&O + ₹10K AGENT REPORT ================\n")
    print(final_report)
    print("\n============================================================\n")
    send_whatsapp_alert(final_report)

def start_timed_bot():
    print(f"⏰ High-Accuracy F&O + ₹10k AI Agent Bot Active! Admin: {TARGET_PHONE}")
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

            # 2. Every 15-Min Live Opportunity Radar (9:25 AM - 3:15 PM -> Skips 9:15 AM Opening Noise Trap!)
            market_open = now_ist.replace(hour=9, minute=25, second=0)
            market_close = now_ist.replace(hour=15, minute=15, second=0)
            if market_open <= now_ist <= market_close and now_ist.minute in [0, 15, 30, 45] and last_radar_min != now_ist.minute:
                last_radar_min = now_ist.minute
                if current_hm not in ALERT_TIMES_IST:
                    run_scanner(only_live_opportunity=True)

        time.sleep(20)

if __name__ == "__main__":
    start_timed_bot()