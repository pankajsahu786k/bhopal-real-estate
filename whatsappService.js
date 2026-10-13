const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

let sock = null;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n================ QR CODE FOR WHATSAPP ================');
            qrcode.generate(qr, { small: true });
            console.log('Scan this QR code from WhatsApp -> Linked Devices\n======================================================\n');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('WhatsApp connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Baileys successfully connected!');
        }
    });
}

// Direct Message Function with Clean Phone Formatting
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

module.exports = { connectToWhatsApp, sendDirectWhatsApp };