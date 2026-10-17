const mongoose = require('mongoose');

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

        const pastMemory = await PersonalChatMemory.findOne({ 
            senderPhone: senderPhone, 
            incomingMsg: new RegExp(messageText, 'i') 
        }).lean();

        if (pastMemory && pastMemory.myReply) {
            personalReply = pastMemory.myReply;
        } else {
            if (messageText.includes('khana') || messageText.includes('kha liya')) {
                personalReply = "Ha kha liya, aapne?";
            } else if (messageText.includes('kahan ho') || messageText.includes('kaha ho')) {
                personalReply = "Bas thoda kaam me hu, batao kya hua?";
            } else if (['hi', 'hello', 'hii', 'gm'].includes(messageText)) {
                personalReply = "Bolo, sab thik?";
            } else {
                personalReply = "Haan sun raha hu, thodi der me call karta hu!";
            }

            await PersonalChatMemory.create({
                senderPhone: senderPhone,
                incomingMsg: messageText,
                myReply: personalReply
            });
        }

        await sendDirectWhatsApp(senderPhone, personalReply);
    } catch (err) {
        console.error("Personal Bot Error:", err);
    }
}

module.exports = { handlePersonalBot };