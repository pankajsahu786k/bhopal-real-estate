const mongoose = require('mongoose');

const knownBhopalAreas = ['arera', 'mp nagar', 'new market', 'kolar', 'ashoka garden', 'indrapuri', 'ayodhya', 'hoshangabad road', 'bawadiya', 'shahpura', 'gulmohar'];
const userConversationState = {};

async function handlePropertyBot(senderPhone, messageText, sendDirectWhatsApp) {
    try {
        const Property = mongoose.models.Property || mongoose.model('Property');

        // Alternative selection check (Short-forms like 'h', 'hn', 'ha')
        const yesKeywords = ['haan', 'ha', 'hn', 'h', 'y', 'ya', 'yes', 'dikhao', 'batao', 'ok', 'okay', 'sure', 'bhejo'];
        const userState = userConversationState[senderPhone];

        if (userState && userState.awaitingAlternative && yesKeywords.includes(messageText)) {
            userConversationState[senderPhone].awaitingAlternative = false;

            let altFilter = { status: 'approved' };
            if (userState.lastPurpose) altFilter.purpose = new RegExp(userState.lastPurpose, 'i');

            let altProps = [];
            if (userState.lastLocation) {
                altProps = await Property.find({ ...altFilter, location: new RegExp(userState.lastLocation, 'i') }).sort({ price: 1 }).limit(3).lean();
            }
            if (altProps.length === 0) {
                altProps = await Property.find(altFilter).sort({ price: 1 }).limit(3).lean();
            }

            if (altProps.length === 0) {
                await sendDirectWhatsApp(senderPhone, `Maaf kijiyega! Abhi koi matching property uplabdh nahi hai.`);
                return;
            }

            let altReply = `💡 *Aapke liye Best Alternative Options:*\n\n`;
            altProps.forEach((p, idx) => {
                altReply += `${idx + 1}. *${p.title || 'Property'}*\n📍 Area: ${p.location}\n💰 Price: ₹${p.price}\n🔗 Link: https://bhopal-real-estate.onrender.com/property-details.html?id=${p._id}\n\n`;
            });
            await sendDirectWhatsApp(senderPhone, altReply);
            return;
        }

        // Greetings for normal customers
        const normalGreetings = ['hi', 'hii', 'hiii', 'hello', 'hey', 'namaste', 'hola', 'hlw', 'gm', 'good morning'];
        if (normalGreetings.includes(messageText)) {
            const hiMsg = `🙏 *Namaste! Bhopal Properties me aapka swagat hai.*\n\nMain aapka Smart Property Assistant hoon. Main aapki kaise madad kar sakta hoon? 😊\n\n🏠 Property dhoondhne ke liye bas apna *Area*, *BHK* ya *Budget* likhein:\n👉 *"2 bhk rent under 12000"*\n👉 *"Ashoka Garden me flat"*\n👉 *"Plot ya House for sale"*`;
            await sendDirectWhatsApp(senderPhone, hiMsg);
            return;
        }

        // Direct Budget Detector (jaise '2000')
        let maxBudget = null;
        const regex = /(\d+)\s*(k|lakh|l|thousand|lac)?/gi;
        let match;
        while ((match = regex.exec(messageText)) !== null) {
            let val = parseInt(match[1]);
            let unit = match[2] ? match[2].toLowerCase() : '';
            if (unit === 'k' || unit === 'thousand') val *= 1000;
            else if (unit === 'l' || unit === 'lakh' || unit === 'lac') val *= 100000;
            if (val >= 500) maxBudget = val;
        }
        if (!maxBudget && !isNaN(messageText.trim()) && parseInt(messageText.trim()) >= 500) {
            maxBudget = parseInt(messageText.trim());
        }

        const matchedArea = knownBhopalAreas.find(area => messageText.includes(area));
        const propKeywords = ['bhk', 'rent', 'flat', 'sale', 'buy', 'sell', 'property', 'plot', 'house', 'makan', 'room', 'kiraye'];
        const hasPropKeyword = propKeywords.some(kw => messageText.includes(kw));

        if (!hasPropKeyword && !matchedArea && !maxBudget) return;

        let filter = { status: 'approved' };
        if (matchedArea) filter.location = new RegExp(matchedArea, 'i');
        if (messageText.includes('rent') || messageText.includes('kiraye')) filter.purpose = /rent/i;
        else if (messageText.includes('sale') || messageText.includes('buy')) filter.purpose = /sale/i;
        if (maxBudget) filter.price = { $lte: maxBudget };

        const matchedProps = await Property.find(filter).sort({ price: 1 }).limit(3).lean();

        if (matchedProps.length === 0) {
            userConversationState[senderPhone] = { awaitingAlternative: true, lastLocation: matchedArea || null, lastBudget: maxBudget || null };
            await sendDirectWhatsApp(senderPhone, `🙏 Namaste! Is budget/area me abhi property nahi hai. Kya iske aas-paas ke options dikhaun? ('Haan' ya 'h' likhein)`);
            return;
        }

        let replyMsg = `🏢 *Bhopal Properties Smart Assistant*\n\n`;
        matchedProps.forEach((p, index) => {
            replyMsg += `${index + 1}. *${p.title || 'Property'}*\n📍 Area: ${p.location}\n💰 Price: ₹${p.price}\n🔗 Link: https://bhopal-real-estate.onrender.com/property-details.html?id=${p._id}\n\n`;
        });
        await sendDirectWhatsApp(senderPhone, replyMsg);
    } catch (err) {
        console.error("Property Bot Error:", err);
    }
}

module.exports = { handlePropertyBot };