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
TARGET_PHONE = "919399115595"

# ⏰ Din mein kin-kin time par automatic WhatsApp notification bhejna hai (24-Hour IST Format)
ALERT_TIMES_IST = ["09:30", "11:30", "13:30", "15:00"]

WATCHLIST = {
    "BEL.NS": "Bharat Electronics",
    "ICICIBANK.NS": "ICICI Bank",
    "TCS.NS": "TCS Tata Consultancy Services",
    "INFY.NS": "Infosys"
}
# =================================================

client = genai.Client(api_key=GEMINI_API_KEY)

def get_ist_now():
    """Indian Standard Time (IST) nikalna"""
    return datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)

def get_stock_data(symbol):
    """Fast tarike se Live Price aur Previous Close nikalna"""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ticker = yf.Ticker(symbol)
            daily_df = ticker.history(period="5d", interval="1d", timeout=10)
            
        if daily_df.empty or len(daily_df) < 2:
            return None

        latest = daily_df.iloc[-1]
        prev_close = round(float(daily_df.iloc[-2]['Close']), 2)
        live_price = round(float(latest['Close']), 2)
        morning_high = round(float(latest['High']), 2)
        change_pct = round(((live_price - prev_close) / prev_close) * 100, 2)

        return {
            "price": live_price,
            "prev_close": prev_close,
            "change_pct": change_pct,
            "morning_high": morning_high
        }
    except Exception as e:
        print(f"   ⚠️ {symbol} data error: {e}")
        return None

def get_latest_news(company_name):
    """10-second timeout ke saath Google News RSS se top 3 khabrein nikalna"""
    try:
        query = urllib.parse.quote(f"{company_name} stock news India")
        rss_url = f"https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"
        resp = requests.get(rss_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        feed = feedparser.parse(resp.content)
        headlines = [entry.title for entry in feed.entries[:3]]
        return headlines if headlines else ["No major news today."]
    except Exception:
        return ["No major news today."]

def generate_smart_rule_report(stocks_list):
    """Backup Smart Engine: Agar Gemini API model error de toh Python khud report banayega"""
    negative_words = ["fall", "drop", "loss", "crash", "down", "weak", "slump", "fraud", "penalty", "sell", "bear", "low"]
    report_lines = ["📊 *INDIAN STOCK MARKET SWING TRADING REPORT*\n"]

    for item in stocks_list:
        name = item["name"]
        symbol = item["symbol"]
        price = item["price"]
        change = item["change_pct"]
        news_list = item["news"]
        news_joined = " ".join(news_list).lower()

        has_bad_news = any(w in news_joined for w in negative_words)

        report_lines.append(f"🏢 *{name} ({symbol})*")
        report_lines.append(f"💰 Live Price: ₹{price} ({change}%)")
        report_lines.append(f"📰 News: {news_list[0]}")

        if change > 0 and not has_bad_news:
            sl = round(price * 0.97, 2)
            t1 = round(price * 1.06, 2)
            t2 = round(price * 1.10, 2)
            report_lines.append("✅ *Signal: PAPER BUY*")
            report_lines.append(f"🎯 Buy Entry: ₹{price}")
            report_lines.append(f"🛑 Stop-Loss (-3%): ₹{sl}")
            report_lines.append(f"🚀 Target 1 (+6%): ₹{t1}")
            report_lines.append(f"🔥 Trailing Target (+10%): ₹{t2}")
        else:
            reason = "Price Negative hai" if change <= 0 else "News sentiment mixed/negative hai"
            report_lines.append(f"⏳ *Signal: NO ENTRY (WAIT)* — ({reason})")

        report_lines.append("-" * 32)

    return "\n".join(report_lines)

def analyze_with_gemini(stock_summary, stocks_list):
    """Gemini AI se report banwana + Safe Fallback"""
    prompt = f"""
    Tum ek strict Indian Stock Market Swing Trading Analyst ho. 
    Neeche live stock data aur latest news headlines hain:
    
    {stock_summary}
    
    Rules:
    1. Agar stock negative (-) hai ya news kharab hai, toh 'NO ENTRY (WAIT)' bolo.
    2. Sirf usi stock ko 'PAPER BUY' bolo jismein price positive ho AUR news negative na ho.
    3. Har 'PAPER BUY' stock ke liye:
       - Buy Entry Price
       - Stop-Loss (-3%)
       - Target 1 (+6%) aur Trailing Target (+10%) calculate karke Hinglish mein short WhatsApp format mein likho.
    """

    try:
        print("🤖 AI Report generate ho rahi hai (gemini-flash-latest)...")
        response = client.models.generate_content(model="gemini-flash-latest", contents=prompt)
        if response and response.text:
            return response.text
    except Exception as e:
        print(f"   ⚠️ gemini-flash-latest error: {str(e)[:100]}")

    try:
        available_models = []
        for m in client.models.list():
            m_name = m.name.replace("models/", "")
            if "gemini" in m_name and not any(old in m_name for old in ["flash-latest", "1.5", "2.0", "2.5", "embedding", "imagen", "veo", "tts", "audio"]):
                available_models.append(m_name)

        for model_name in available_models:
            try:
                print(f"🤖 Trying Gemini Model: {model_name}...")
                response = client.models.generate_content(model=model_name, contents=prompt)
                if response and response.text:
                    return response.text
            except Exception as err:
                print(f"   ⚠️ {model_name} skipped: {str(err)[:100]}")
    except Exception as list_err:
        print(f"   ⚠️ Model list check skipped: {str(list_err)[:100]}")

    print("⚡ Using Built-in Smart Swing Trading Engine...")
    return generate_smart_rule_report(stocks_list)

def run_scanner():
    print("🚀 Scanning live market & news (Fast Mode)...")
    summary_text = ""
    stocks_list = []
    total = len(WATCHLIST)
    
    for idx, (symbol, name) in enumerate(WATCHLIST.items(), start=1):
        print(f"⏳ [{idx}/{total}] {name} ({symbol}) check ho raha hai...")
        data = get_stock_data(symbol)
        news = get_latest_news(name)
        if data:
            stocks_list.append({
                "symbol": symbol,
                "name": name,
                "price": data["price"],
                "change_pct": data["change_pct"],
                "morning_high": data["morning_high"],
                "news": news
            })
            summary_text += f"\nStock: {name} ({symbol})\n"
            summary_text += f"Live Price: ₹{data['price']} ({data['change_pct']}%)\n"
            summary_text += f"Day High: ₹{data['morning_high']}\n"
            summary_text += f"Latest News: {' | '.join(news)}\n"
            summary_text += "-" * 30

    if not stocks_list:
        print("❌ Kisi bhi stock ka data nahi mila. Internet connection check karein.")
        return

    final_report = analyze_with_gemini(summary_text, stocks_list)
    print("\n================ AI RESEARCH REPORT ================\n")
    print(final_report)
    print("\n====================================================")

    # 📲 Send Report to WhatsApp via Node.js Server Webhook
    try:
        print(f"📡 WhatsApp par report bheji ja rahi hai ({TARGET_PHONE})...")
        res = requests.post(
            WHATSAPP_WEBHOOK_URL,
            json={"phone": TARGET_PHONE, "message": final_report},
            timeout=15
        )
        if res.status_code == 200:
            print("✅ Report seedha aapke WhatsApp par bhej di gayi!")
        else:
            print(f"⚠️ Server ne {res.status_code} return kiya.")
    except Exception as e:
        print(f"⚠️ WhatsApp Webhook connect nahi ho paya: {e}")

def start_timed_bot():
    print(f"⏰ Stock Bot Time Scheduler Chalu Ho Gaya! (Alert Timings IST: {', '.join(ALERT_TIMES_IST)})")
    # Script start hote hi ek baar turant report bhejega
    run_scanner()
    last_sent_slot = ""

    while True:
        now_ist = get_ist_now()
        current_hm = now_ist.strftime("%H:%M")
        date_slot_key = f"{now_ist.strftime('%Y-%m-%d')}_{current_hm}"

        # Monday (0) se Friday (4) ke beech scheduled time par automatic run karega
        if now_ist.weekday() < 5 and current_hm in ALERT_TIMES_IST and last_sent_slot != date_slot_key:
            print(f"\n🔔 [{current_hm} IST] Scheduled Market Alert Triggered!")
            last_sent_slot = date_slot_key
            run_scanner()

        time.sleep(20)

if __name__ == "__main__":
    start_timed_bot()