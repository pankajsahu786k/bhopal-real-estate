const express = require('express');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

const app = express();
app.use(express.json()); // SMS का डेटा पढने के लिए

// ==========================================
// 1. SMS RECEIVER BOT (Webhook)
// ==========================================
app.post('/api/payment-sms', async (req, res) => {
    try {
        const smsText = req.body.message; // मोबाइल ऐप से आने वाला SMS
        console.log(`📱 SMS Aaya: ${smsText}`);

        const match = smsText.match(/(RK_BKG_\d+)/);
        if (match) {
            const uniqueTxNote = match[1];
            await verifyPayment(uniqueTxNote, 'SMS');
        }
        res.status(200).send("SMS Received by Bot");
    } catch (error) {
        res.status(500).send("Error");
    }
});

// ==========================================
// 2. EMAIL RECEIVER BOT (IMAP)
// ==========================================
const config = {
    imap: {
        user: 'devilking786k@gmail.com',
        password: 'fwjfxksjofqvkpil',
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
                    await verifyPayment(uniqueTxNote, 'EMAIL');
                }
            }
        });
    } catch (error) {
        console.error("❌ Email Bot Error:", error);
    }
}

// ==========================================
// 3. COMMON PAYMENT VERIFIER (Double Check)
// ==========================================
async function verifyPayment(txNote, source) {
    // Yahan hum database check karenge
    // Maan lijiye BookingModel aapka database hai
    
    // Step A: Check karein ki kya payment pehle hi kisi aur source se aagayi hai?
    // const booking = await BookingModel.findOne({ txNote: txNote });
    
    // if (booking.status === 'Success') {
    //     console.log(`⏩ ${txNote} pehle hi confirm ho chuka hai. (${source} ignored)`);
    //     return;
    // }

    // Step B: Agar confirm nahi hai, toh SUCCESS kar do
    // await BookingModel.findOneAndUpdate({ txNote: txNote }, { status: 'Success' });
    console.log(`✅ SUCCESS! Payment Confirmed for ${txNote} via ${source} 🚀`);
}

// Server aur Bot Start karein
app.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
    startEmailBot(); // Email bot background me chalega
});