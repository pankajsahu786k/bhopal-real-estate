const { 
    default: makeWASocket, 
    DisconnectReason, 
    initAuthCreds, 
    BufferJSON 
} = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const pino = require('pino');
const QRCode = require('qrcode');

let sock = null;
let currentQrData = null; // Browser par dikhane ke liye

// =========================================================================
// 🗄️ MONGODB WHATSAPP SESSION SCHEMA (PERMANENT STORAGE)
// =========================================================================
const whatsappAuthSchema = new mongoose.Schema({
    _id: String,
    data: String
}, { collection: 'whatsapp_baileys_auth' });

const WhatsAppAuth = mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', whatsappAuthSchema);

// Custom MongoDB Auth State Adapter
async function useMongoDBAuthState() {
    const writeData = async (id, data) => {
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await WhatsAppAuth.findByIdAndUpdate(
            id, 
            { _id: id, data: serialized }, 
            { upsert: true }
        );
    };

    const readData = async (id) => {
        try {
            const doc = await WhatsAppAuth.findById(id);
            if (!doc || !doc.data) return null;
            return JSON.parse(doc.data, BufferJSON.reviver);
        } catch (err) {
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            await WhatsAppAuth.findByIdAndDelete(id);
        } catch (err) {}
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            data[id] = value;
                        })
                    );
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

// =========================================================================
// 📱 WHATSAPP CONNECTION ENGINE & AI BOT LISTENER
// =========================================================================
async function connectToWhatsApp() {
    try {
        if (mongoose.connection.readyState !== 1) {
            console.log('⏳ Waiting for MongoDB connection before starting WhatsApp...');
            await new Promise(resolve => mongoose.connection.once('connected', resolve));
        }

        const { state, saveCreds } = await useMongoDBAuthState();

        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        // 🤖 BAILEYS INCOMING MESSAGE BOT LISTENER
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return;
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const senderPhone = msg.key.remoteJid; // e.g. 919993352339@s.whatsapp.net
               let m = msg.message;
// Disappearing aur ViewOnce messages ko handle karne ke liye
if (m.ephemeralMessage) m = m.ephemeralMessage.message;
if (m.viewOnceMessage) m = m.viewOnceMessage.message;
if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;

const messageText = (
    m.conversation || 
    m.extendedTextMessage?.text || 
    m.imageMessage?.caption || 
    ''
).toLowerCase().trim();

                if (!messageText) return;
                console.log(`📩 Baileys Message Mila: "${messageText}" from ${senderPhone}`);

                // Property Search Bot Logic
                if (messageText.includes('bhk') || messageText.includes('rent') || messageText.includes('flat') || messageText.includes('arera') || messageText.includes('market') || messageText.includes('sale')) {
                    
                    // Property Model ko mongoose se dynamically access karein
                    const Property = mongoose.models.Property || mongoose.model('Property');
                    let filter = { status: 'approved' };

                    if (messageText.includes('arera')) filter.location = /arera/i;
                    else if (messageText.includes('new market')) filter.location = /new market/i;
                    else if (messageText.includes('mp nagar')) filter.location = /mp nagar/i;

                    if (messageText.includes('rent') || messageText.includes('kiraye')) filter.purpose = /rent/i;
                    else if (messageText.includes('buy') || messageText.includes('sale')) filter.purpose = /sale/i;

                    const matchedProps = await Property.find(filter).limit(3).lean();

                    if (matchedProps.length === 0) {
                        await sendDirectWhatsApp(senderPhone, `🙏 Namaste! Aapki khoj "${messageText}" ke liye abhi koi property uplabdh nahi hai. Website visit karein: https://bhopal-real-estate.onrender.com`);
                    } else {
                        let replyMsg = `🏢 *Bhopal Properties AI Bot*\nAapki talash ke anusaar yeh top properties milti hain:\n\n`;
                        matchedProps.forEach((p, index) => {
                            const propUrl = `https://bhopal-real-estate.onrender.com/property-details.html?id=${p._id}`;
                            replyMsg += `${index + 1}. *${p.title || 'Property'}*\n📍 Location: ${p.location}\n💰 Price: ₹${p.price}\n🔗 Dekhein: ${propUrl}\n\n`;
                        });
                        replyMsg += `📞 Adhik jankari ke liye call karein!`;

                        await sendDirectWhatsApp(senderPhone, replyMsg);
                    }
                }
            } catch (botErr) {
                console.error("WhatsApp AI Bot Execution Error:", botErr);
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                currentQrData = await QRCode.toDataURL(qr);
                console.log('📌 Naya QR code ready hai! Browser me /qr open karke scan karein.');
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('WhatsApp connection closed. Reconnecting:', shouldReconnect);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('⚠️ Device logged out from mobile! Clearing old session from MongoDB...');
                    await WhatsAppAuth.deleteMany({});
                    connectToWhatsApp();
                } else if (shouldReconnect) {
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                currentQrData = null;
                console.log('✅ WhatsApp Baileys successfully connected (Saved in MongoDB Permanently)!');
            }
        });
    } catch (err) {
        console.error('WhatsApp Init Error:', err.message);
    }
}

async function sendDirectWhatsApp(phone, text) {
    if (!sock) {
        console.error('❌ WhatsApp socket is not connected yet.');
        return false;
    }
    try {
        let jid = phone.toString();
        
        // Agar phone format me '@' nahi hai (yani API se sirf normal number aaya hai)
        if (!jid.includes('@')) {
            let cleanPhone = jid.replace(/[^0-9]/g, '');
            if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
                cleanPhone = '91' + cleanPhone;
            }
            jid = `${cleanPhone}@s.whatsapp.net`;
        }
        
        await sock.sendMessage(jid, { text: text });
        console.log(`📤 Direct message sent to ${jid}`);
        return true;
    } catch (err) {
        console.error(`❌ Failed to send message to ${phone}:`, err.message);
        return false;
    }
}

function getLatestQr() {
    return currentQrData;
}

module.exports = { connectToWhatsApp, sendDirectWhatsApp, getLatestQr };