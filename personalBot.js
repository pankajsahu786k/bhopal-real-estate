// Yahan aap apne VIPs ke liye parameters aur custom rules set kar sakte hain
async function handlePersonalBot(senderPhone, messageText, sendDirectWhatsApp) {
    try {
        let personalReply = "Ha bolo ji"; // Default fallback

        // 🧠 CUSTOM PARAMETERS & RULES (Apne hisaab se aur conditions jod sakte hain)
        if (messageText.includes('khana') || messageText.includes('kha liya')) {
            personalReply = "Ha kha liya, aapne?";
        } 
        else if (messageText.includes('kahan ho') || messageText.includes('kaha ho')) {
            personalReply = "Bas thoda kaam me busy hu, batao kya hua?";
        } 
        else if (messageText.includes('kab aaoge') || messageText.includes('ghar aaoge')) {
            personalReply = "Bas thodi der me nikal raha hu wahan se!";
        } 
        else if (['hi', 'hello', 'hii', 'gm'].includes(messageText)) {
            personalReply = "Bolo, sab thik?";
        } 
        else {
            // Agar koi aisi baat ho jo upar match na ho, toh yeh auto-reply jayega
            personalReply = "Haan sun raha hu, thodi der me call karta hu!";
        }

        await sendDirectWhatsApp(senderPhone, personalReply);
        console.log(`🤖 [Personal Bot] Custom Reply Sent to VIP (${senderPhone}): "${personalReply}"`);
    } catch (err) {
        console.error("Personal Bot Error:", err);
    }
}

module.exports = { handlePersonalBot };