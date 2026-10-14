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

// Custom MongoDB Auth State Adapter (No extra npm package needed)
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

    // Purana session database se load karein ya naya banayein
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
// 📱 WHATSAPP CONNECTION ENGINE
// =========================================================================
async function connectToWhatsApp() {
    try {
        // Ensure MongoDB connected ho tabhi session uthaye
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
                currentQrData = null; // Connected hone par QR clear kar dein
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
        let cleanPhone = phone.toString().replace(/[^0-9]/g, '');
        if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        }
        const jid = `${cleanPhone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: text });
        console.log(`📤 Direct message sent to ${cleanPhone}`);
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