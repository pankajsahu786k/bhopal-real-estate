const express = require('express');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

const app = express();
app.use(express.json()); 

// 🌟 टेस्टिंग के लिए टेम्पररी डेटाबेस (पेमेंट का स्टेटस सेव करने के लिए)
const paymentStatus = {}; 

// ==========================================
// 1. SMS RECEIVER BOT (Webhook) - MacroDroid यहाँ सिग्नल भेजेगा
// ==========================================
app.post('/api/webhook', async (req, res) => {
    try {
        const smsText = req.body.smsText || ""; // 🌟 MacroDroid वाला सही नाम
        console.log(`📱 SMS Aaya: ${smsText}`);

        const match = smsText.match(/(RK_BKG_\d+)/);
        if (match) {
            const uniqueTxNote = match[1];
            paymentStatus[uniqueTxNote] = 'Success'; // स्टेटस अपडेट कर दिया
            console.log(`✅ SUCCESS! Payment Confirmed for ${uniqueTxNote} via SMS 🚀`);
        }
        res.status(200).send("SMS Received by Bot");
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send("Error");
    }
});

// ==========================================
// 2. CHECK PAYMENT STATUS (Polling API) - आपका पेज यहाँ से पूछेगा
// ==========================================
app.get('/api/check-payment-status', (req, res) => {
    const txnId = req.query.txnId;
    const currentStatus = paymentStatus[txnId] || 'Pending';
    res.json({ status: currentStatus });
});

// ==========================================
// 3. EMAIL RECEIVER BOT (IMAP) - (इसे अभी के लिए ऐसे ही रहने दें)
// ==========================================
const config = {
    imap: {
        user: process.env.EMAIL,        
        password: process.env.EMAIL_PASSWORD, 
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 3000
    }
};

async function startEmailBot() {
    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        console.log("📩 Email Bot INBOX monitor kar raha hai...");

        connection.on('mail', async () => {
            const searchCriteria = ['UNSEEN'];
            const fetchOptions = { bodies: [''], markSeen: true };
            const messages = await connection.search(searchCriteria, fetchOptions);
            
            for (let item of messages) {
                const all = item.parts.find(part => part.which === '');
                const idHeader = "Imap-Id: " + item.attributes.uid + "\r\n";
                const mail = await simpleParser(idHeader + all.body);
                
                const match = (mail.text || "").match(/(RK_BKG_\d+)/);
                if (match) {
                    const uniqueTxNote = match[1];
                    paymentStatus[uniqueTxNote] = 'Success';
                    console.log(`✅ SUCCESS! Payment Confirmed for ${uniqueTxNote} via EMAIL 🚀`);
                }
            }
        });
    } catch (error) {
        console.error("❌ Email Bot Error:", error);
    }
}

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    // startEmailBot(); // टेस्टिंग के लिए इसे अभी कमेंट रखा है
});