const mongoose = require('mongoose');

// Personal chats ko yaad rakhne aur seekhne ke liye schema
const personalChatSchema = new mongoose.Schema({
    senderPhone: String,
    incomingMsg: String,
    myReply: String,
    createdAt: { type: Date, default: Date.now }
}, { collection: 'personal_chat_learning_memory' });

const PersonalChatMemory = mongoose.models.PersonalChatMemory || mongoose.model('PersonalChatMemory', personalChatSchema);

async function handlePersonalBot(senderPhone, messageText, sendDirectWhatsApp) {
    try {
        let personalReply = "";

        // 🧠 1. MEMORY CHECK (Database me dhoondo ki kya ye message pehle aaya tha?)
        const pastMemory = await PersonalChatMemory.findOne({ 
            senderPhone: senderPhone, 
            incomingMsg: new RegExp(messageText, 'i') 
        }).lean();

        if (pastMemory && pastMemory.myReply) {
            // Self-learning memory se exact purana jawab utha liya!
            personalReply = pastMemory.myReply;
            console.log(`🧠 [Memory Match] Purane experience se jawab diya: "${personalReply}"`);
        } else {
            // 🧠 2. SMART FALLBACK & LEARNING
            if (messageText.includes('khana') || messageText.includes('kha liya')) {
                personalReply = "Ha kha liya, aapne?";
            } else if (messageText.includes('kahan ho') || messageText.includes('kaha ho')) {
                personalReply = "Bas thoda kaam me hu, batao kya hua?";
            } else if (['hi', 'hello', 'hii', 'gm'].includes(messageText)) {
                personalReply = "Bolo, sab thik?";
            } else {
                personalReply = "Haan sun raha hu, thodi der me call karta hu!";
            }

            // 🧠 3. AUTO-SAVE TO MEMORY (Nayi baat ko database me hamesha ke liye seekh kar save kar liya)
            await PersonalChatMemory.create({
                senderPhone: senderPhone,
                incomingMsg: messageText,
                myReply: personalReply
            });
            console.log(`📚 [New Learning] Nayi baat database me sikhakar save kar li!`);
        }

        await sendDirectWhatsApp(senderPhone, personalReply);

    } catch (err) {
        console.error("Self-Learning Personal Bot Error:", err);
    }
}

module.exports = { handlePersonalBot };