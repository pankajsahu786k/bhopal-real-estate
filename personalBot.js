const mongoose = require('mongoose');

// Chat Memory Schema
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

        // 🧠 1. MEMORY MATCH (Agar pehle kabhi ye baat hui ho)
        const pastMemory = await PersonalChatMemory.findOne({ 
            senderPhone: senderPhone, 
            incomingMsg: new RegExp(messageText, 'i') 
        }).lean();

        if (pastMemory && pastMemory.myReply) {
            personalReply = pastMemory.myReply;
        } else {
            // 🧠 2. ADVANCED TRAINING RULES (Natural & Human-like Conversational Logic)
            
            // Agar message "hmm", "ok", "acha" jaisa ho
            if (['hmm', 'hmmm', 'ok', 'acha', 'accha', 'k', 'thik h'].includes(messageText)) {
                const randomReplies = ["Haa bolo", "Batao kya chal raha hai?", "Hmm sun raha hu", "Bolo ji"];
                personalReply = randomReplies[Math.floor(Math.random() * randomReplies.length)];
            } 
            // Agar koi mazaak ya taana maare (jaise "arey koi esa msg karta h kya")
            else if (messageText.includes('aisa msg') || messageText.includes('ese msg') || messageText.includes('pagal') || messageText.includes('mazak')) {
                const funnyReplies = ["Haha arey yaar test kar raha tha bot ko 😂", "Acha sorry sorry, abhi dhyan deta hu!", "Lol, bot thoda ajeeb ho gaya hai 😅"];
                personalReply = funnyReplies[Math.floor(Math.random() * funnyReplies.length)];
            } 
            // Khana-peena ya routine baatein
            else if (messageText.includes('khana') || messageText.includes('kha liya')) {
                personalReply = "Haan ho gaya, aapne khaya?";
            } 
            // Location ya availability
            else if (messageText.includes('kahan') || messageText.includes('kaha') || messageText.includes('free') ) {
                personalReply = "Bas thoda kaam nipta raha hu, free hoke batata hu.";
            } 
            // Greetings
            else if (['hi', 'hello', 'hii', 'gm', 'hey'].includes(messageText)) {
                const hiReplies = ["Bolo ji, kya haal hai?", "Haa bhai, batao?", "Sunao, sab badhiya?"];
                personalReply = hiReplies[Math.floor(Math.random() * hiReplies.length)];
            } 
            // Default smart casual fallback (Bina robotic bane)
            else {
                const casualReplies = ["Achha acha, samajh gaya. Thodi der me baat karta hu!", "Sahi hai, batao aur kya naya?", "Haan dekhta hu isko!"];
                personalReply = casualReplies[Math.floor(Math.random() * casualReplies.length)];
            }

            // Database me memory save karo
            await PersonalChatMemory.create({
                senderPhone: senderPhone,
                incomingMsg: messageText,
                myReply: personalReply
            });
        }

        await sendDirectWhatsApp(senderPhone, personalReply);
        console.log(`🤖 [Trained Personal Bot] Sent: "${personalReply}" for incoming: "${messageText}"`);

    } catch (err) {
        console.error("Trained Personal Bot Error:", err);
    }
}

module.exports = { handlePersonalBot };