const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');

let sock = null;
let currentQrData = null; // Browser par dikhane ke liye

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            // QR string ko image DataURL me convert karein
            currentQrData = await QRCode.toDataURL(qr);
            console.log('📌 Naya QR code ready hai! Browser me /qr open karke scan karein.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('WhatsApp connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            currentQrData = null; // Connected hone par QR clear kar dein
            console.log('✅ WhatsApp Baileys successfully connected!');
        }
    });
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