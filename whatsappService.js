const { 
    default: makeWASocket, 
    DisconnectReason, 
    initAuthCreds, 
    BufferJSON 
} = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const pino = require('pino');
const QRCode = require('qrcode');

const { handlePropertyBot } = require('./propertyBot');
const { handlePersonalBot } = require('./personalBot');

let sock = null;
let currentQrData = null; 

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

                // =========================================================================
                // 🎯 ROUTER: VIP PERSONAL BOT VS PROPERTY BOT (Universal 10-Digit Matcher)
                // =========================================================================
                // Yahan apne VIPs ka sirf 10 digits ka mobile number daal dein
                const vipSpecialNumbers = ['9575611622']; // <--- Apna ya unka 10 digit number yahan daalein

                const cleanSenderNumber = senderPhone.replace(/[^0-9]/g, '').slice(-10);

                if (vipSpecialNumbers.includes(cleanSenderNumber)) {
                    await handlePersonalBot(senderPhone, messageText, sendDirectWhatsApp);
                    console.log(`🤖 [Router] Routed to Personal Bot for VIP: ${senderPhone}`);
                } else {
                    await handlePropertyBot(senderPhone, messageText, sendDirectWhatsApp);
                    console.log(`🏢 [Router] Routed to Property Bot for Customer: ${senderPhone}`);
                }

            } catch (botErr) {
                console.error("Main Router Error:", botErr);
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) currentQrData = await QRCode.toDataURL(qr);
            if (connection === 'close') {
                setTimeout(() => connectToWhatsApp(), 3000);
            } else if (connection === 'open') {
                currentQrData = null;
                console.log('✅ WhatsApp Connected with Modular Dual-Bot System!');
            }
        });
    } catch (err) {}
}

async function sendDirectWhatsApp(phone, text) {
    if (!sock) return false;
    try {
        let jid = phone.toString();
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