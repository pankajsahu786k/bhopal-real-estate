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

const ADMIN_STOCK_PHONE = "919399115595"; // 🔒 Exclusive Admin Number for Stock, F&O & ₹10k AI Agent

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
                if (!msg.message) return;

                const senderPhone = msg.key.remoteJid || ''; 
                if (senderPhone.includes('@g.us') || senderPhone === 'status@broadcast') return;

                let m = msg.message;
                if (m.ephemeralMessage) m = m.ephemeralMessage.message;
                if (m.viewOnceMessage) m = m.viewOnceMessage.message;
                if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;

                const rawText = (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '').trim();
                const messageText = rawText.toLowerCase();
                if (!messageText) return;

                const upperText = rawText.toUpperCase().trim();

                // 🎧 Check if it's a Customer Care Telecaller Command
                const isTelecallerCmd = (
                    upperText === 'START' || 
                    upperText === 'TASK' || 
                    upperText === 'TASKS' || 
                    upperText === 'NEXT' ||
                    upperText.includes('AJ KE TASK') || 
                    upperText.includes('AAJ KE TASK') || 
                    upperText.includes('AAJ KA TASK') ||
                    upperText.includes('AJ KA TASK') ||
                    upperText.startsWith('READ ') || 
                    upperText === 'LEAVE' ||
                    upperText === 'HOLD' || 
                    upperText.startsWith('HOLD ') || 
                    upperText === 'DONE' || 
                    upperText.startsWith('DONE ') || 
                    upperText.includes('TASK 1 DONE')
                );

                // 📈 Check if it's an Admin Stock / Wallet / Festival Wish Command
                const exactAdminCommands = [
                    'stock', 'fno', 'f&o', 'f and o', 'best deal', 'nifty', 'banknifty',
                    'market', 'report', 'market report', 'stock report',
                    'wallet', 'portfolio', 'agent', 'fund', 'balance', 'reset wallet'
                ];
                const isExactStockCmd = exactAdminCommands.includes(messageText) || messageText.startsWith('wish ');

                if (msg.key.fromMe && !isExactStockCmd && !isTelecallerCmd) return;

                console.log(`📩 Message Mila: "${rawText}" from ${senderPhone}`);

                const cleanSenderNumber = senderPhone.replace(/[^0-9]/g, '');
                const PORT = process.env.PORT || 3000;

                // =========================================================================
                // 🎧 1. CUSTOMER CARE TELECALLER WHATSAPP COMMAND BRIDGE (100% @lid SAFE)
                // =========================================================================
                if (isTelecallerCmd) {
                    console.log(`🎧 [Telecaller Router] Forwarding command "${rawText}" to Support Queue...`);
                    await fetch(`http://127.0.0.1:${PORT}/api/support/whatsapp-command`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            senderPhone: cleanSenderNumber || senderPhone, 
                            messageText: rawText,
                            isTrustedBridge: true // ✅ Bypasses @lid mismatch so DONE always works!
                        })
                    }).catch(err => console.error("Telecaller Bridge Error:", err.message));
                    return; // 🛑 Stop here so Property Bot doesn't reply!
                }

                // =========================================================================
                // ⚡ 2. INSTANT 1.5s ADMIN F&O, STOCK, WALLET & FESTIVAL WISH BRIDGE
                // =========================================================================
                const isStockOrAgentQuery = isExactStockCmd || exactAdminCommands.some(
                    k => messageText === k || (messageText.length <= 25 && messageText.includes(k))
                );
                const isFromAdmin = cleanSenderNumber.includes('9399115595') || msg.key.fromMe || senderPhone.includes('@lid');

                if (isStockOrAgentQuery && isFromAdmin) {
                    console.log(`📈 [AI Stock/Admin Router] Triggering Instant Command "${rawText}" for Admin...`);
                    await fetch(`http://127.0.0.1:${PORT}/api/whatsapp/incoming-bot`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            senderPhone: ADMIN_STOCK_PHONE,
                            messageText: rawText
                        })
                    }).catch(err => console.error("Stock Bot Local Trigger Error:", err.message));
                    return;
                }

                // =========================================================================
                // 🔗 3. TENANT INSTANT PAYMENT LINK RESEND ("1" or "LINK")
                // =========================================================================
                if (messageText === '1' || messageText === 'link' || messageText.includes('payment link') || messageText.includes('link bhej')) {
                    await fetch(`http://127.0.0.1:${PORT}/api/whatsapp/incoming-bot`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            senderPhone: senderPhone,
                            messageText: rawText
                        })
                    }).catch(() => {});
                    return;
                }

                // =========================================================================
                // 🎯 4. ROUTER: VIP PERSONAL BOT VS PROPERTY BOT
                // =========================================================================
                const vipSpecialNumbers = [
                    '9575611622', 
                    '101155103338740', 
                    '7000931152', 
                    '97830882545707', 
                    '8827162824', 
                    '108070118121648'
                ]; 

                const isVip = vipSpecialNumbers.some(vip => senderPhone.includes(vip) || cleanSenderNumber.includes(vip));

                if (isVip) {
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
                console.log('✅ WhatsApp Connected with Modular Dual-Bot + ₹10k AI Stock Agent System!');
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