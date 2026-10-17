const { 
    default: makeWASocket, 
    DisconnectReason, 
    initAuthCreds, 
    BufferJSON 
} = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const pino = require('pino');
const QRCode = require('qrcode');

// 🧠 GOOGLE GEMINI AI SETUP (FREE BRAIN)
const { GoogleGenerativeAI } = require("@google/generative-ai");
// 👇 APNI GOOGLE AI STUDIO WALI FREE KEY YAHAN ZAROOR DAALEIN
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YAHAN_APNI_API_KEY_PASTE_KAREIN"); 

let sock = null;
let currentQrData = null; 

// =========================================================================
// 🗄️ MONGODB WHATSAPP SESSION SCHEMA
// =========================================================================
const whatsappAuthSchema = new mongoose.Schema({
    _id: String,
    data: String
}, { collection: 'whatsapp_baileys_auth' });
const WhatsAppAuth = mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', whatsappAuthSchema);

async function useMongoDBAuthState() {
    const writeData = async (id, data) => {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await WhatsAppAuth.findByIdAndUpdate(id, { _id: id, data: serialized }, { upsert: true });
    };
    const readData = async (id) => {
        try {
            const doc = await WhatsAppAuth.findById(id);
            if (!doc || !doc.data) return null;
            return JSON.parse(doc.data, BufferJSON.reviver);
        } catch (err) { return null; }
    };
    const removeData = async (id) => {
        try { await WhatsAppAuth.findByIdAndDelete(id); } catch (err) {}
    };
    const creds = (await readData('creds')) || initAuthCreds();
    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => { data[id] = await readData(`${type}-${id}`); }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(key, value) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData('creds', creds)
    };
}

// 🧠 AI REPLY GENERATOR FUNCTION (For Normal Chats)
async function getSmartAIReply(userMessage) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Tum 'Bhopal Properties' ke ek smart WhatsApp assistant ho. Tumhara naam Pankaj ka Assistant hai.
        User ne bola hai: "${userMessage}"
        Ek chhota, friendly aur helpful reply do (Hinglish language me). Agar user property dhoondh raha ho, toh use bolo ki exact detail likhe (jaise "2 bhk rent under 10k"). Koi code ya formatting mat dena, sirf normal WhatsApp message likho.`;
        
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.log("AI Error:", e.message);
        return null;
    }
}

// =========================================================================
// 📱 WHATSAPP CONNECTION ENGINE
// =========================================================================
async function connectToWhatsApp() {
    try {
        if (mongoose.connection.readyState !== 1) {
            await new Promise(resolve => mongoose.connection.once('connected', resolve));
        }

        const { state, saveCreds } = await useMongoDBAuthState();

        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return;
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const senderPhone = msg.key.remoteJid; 
                
                let m = msg.message;
                if (m.ephemeralMessage) m = m.ephemeralMessage.message;
                if (m.viewOnceMessage) m = m.viewOnceMessage.message;
                if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;

                const messageText = (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '').toLowerCase().trim();
                if (!messageText) return;

                console.log(`📩 Message Mila: "${messageText}" from ${senderPhone}`);

                // 👋 1. GREETING LOGIC (Ab isme 'gm' bhi hai)
                const greetings = ['hi', 'hello', 'hey', 'namaste', 'hola', 'hlw', 'gm', 'good morning', 'good evening'];
                if (greetings.includes(messageText)) {
                    const welcomeMsg = `🙏 *Namaste! Bhopal Properties me aapka swagat hai.*\n\nMain ek AI Assistant hoon. Main aapki kaise madad kar sakta hoon? 😊\n\n🏠 Aap yahan properties search kar sakte hain. Kripya apni jarurat aur budget batayein, jaise:\n👉 *"2 bhk rent under 15k"*\n👉 *"Arera colony flat 20000 tak"*\n👉 *"Sale property 50 lakh"*`;
                    await sendDirectWhatsApp(senderPhone, welcomeMsg);
                    return; 
                }

                // 🔍 2. PROPERTY SEARCH BOT LOGIC (With Upgraded Budget Extractor)
                const isPropertySearch = messageText.includes('bhk') || messageText.includes('rent') || messageText.includes('flat') || messageText.includes('arera') || messageText.includes('market') || messageText.includes('sale') || messageText.includes('kharidna') || messageText.includes('kiraye');

                if (isPropertySearch) {
                    const Property = mongoose.models.Property || mongoose.model('Property');
                    let filter = { status: 'approved' };

                    if (messageText.includes('arera')) filter.location = /arera/i;
                    else if (messageText.includes('new market')) filter.location = /new market/i;
                    else if (messageText.includes('mp nagar')) filter.location = /mp nagar/i;

                    if (messageText.includes('rent') || messageText.includes('kiraye')) filter.purpose = /rent/i;
                    else if (messageText.includes('buy') || messageText.includes('sale') || messageText.includes('kharidna')) filter.purpose = /sale/i;

                    let maxBudget = null;
                    const regex = /(\d+)\s*(k|lakh|l|thousand|lac)?/gi;
                    let match;
                    while ((match = regex.exec(messageText)) !== null) {
                        let val = parseInt(match[1]);
                        let unit = match[2] ? match[2].toLowerCase() : '';
                        if (unit === 'k' || unit === 'thousand') val *= 1000;
                        else if (unit === 'l' || unit === 'lakh' || unit === 'lac') val *= 100000;
                        if (val >= 500) maxBudget = val;
                    }

                    if (maxBudget) filter.price = { $lte: maxBudget };

                    const matchedProps = await Property.find(filter).limit(3).lean();

                    if (matchedProps.length === 0) {
                        let noPropMsg = `🙏 Namaste! Aapki khoj ke hisaab se abhi koi property uplabdh nahi hai.`;
                        if (maxBudget) noPropMsg += ` (Budget: ₹${maxBudget} tak)`;
                        noPropMsg += `\nKripya hamari website visit karein: https://bhopal-real-estate.onrender.com`;
                        await sendDirectWhatsApp(senderPhone, noPropMsg);
                    } else {
                        let replyMsg = `🏢 *Bhopal Properties AI Bot*\n`;
                        if (maxBudget) replyMsg += `✅ *Budget:* ₹${maxBudget} ke andar\n\nAapki talash ke anusaar yeh properties milti hain:\n\n`;
                        else replyMsg += `Aapki talash ke anusaar yeh top properties milti hain:\n\n`;

                        matchedProps.forEach((p, index) => {
                            replyMsg += `${index + 1}. *${p.title || 'Property'}*\n📍 Location: ${p.location}\n💰 Price: ₹${p.price}\n🔗 Dekhein: https://bhopal-real-estate.onrender.com/property-details.html?id=${p._id}\n\n`;
                        });
                        replyMsg += `📞 Adhik jankari ke liye call karein!`;
                        await sendDirectWhatsApp(senderPhone, replyMsg);
                    }
                    return; // Property mil gayi toh aage AI ke paas mat jao
                }

                // 🤖 3. FREE AI BRAIN (Agar property search nahi hai, toh AI khud reply sochega!)
                const aiReply = await getSmartAIReply(messageText);
                if (aiReply) {
                    await sendDirectWhatsApp(senderPhone, aiReply);
                }

            } catch (botErr) {
                console.error("WhatsApp AI Bot Execution Error:", botErr);
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) currentQrData = await QRCode.toDataURL(qr);
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut) {
                    await WhatsAppAuth.deleteMany({});
                    connectToWhatsApp();
                } else {
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                currentQrData = null;
                console.log('✅ WhatsApp Baileys connected with FREE AI BRAIN!');
            }
        });
    } catch (err) {}
}

async function sendDirectWhatsApp(phone, text) {
    if (!sock) return false;
    try {
        let jid = phone.toString();
        // @lid format fix
        if (!jid.includes('@')) {
            let cleanPhone = jid.replace(/[^0-9]/g, '');
            if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
            jid = `${cleanPhone}@s.whatsapp.net`;
        }
        await sock.sendMessage(jid, { text: text });
        return true;
    } catch (err) { return false; }
}

function getLatestQr() { return currentQrData; }
module.exports = { connectToWhatsApp, sendDirectWhatsApp, getLatestQr };