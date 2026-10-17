const { 
    default: makeWASocket, 
    DisconnectReason, 
    initAuthCreds, 
    BufferJSON 
} = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const pino = require('pino');
const QRCode = require('qrcode');

let sock = null;
let currentQrData = null; 

// 🧠 CONVERSATION MEMORY (Kis user ne kya maanga tha, wo yaad rakhne ke liye)
const userConversationState = {};

// =========================================================================
// 🗄️ 1. MONGODB WHATSAPP SESSION SCHEMA
// =========================================================================
const whatsappAuthSchema = new mongoose.Schema({
    _id: String,
    data: String
}, { collection: 'whatsapp_baileys_auth' });
const WhatsAppAuth = mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', whatsappAuthSchema);

// =========================================================================
// 🧠 2. SELF-LEARNING AI MEMORY SCHEMA (Khud seekhne wala Database)
// =========================================================================
const botLearningSchema = new mongoose.Schema({
    keyword: { type: String, unique: true },
    category: { type: String, default: 'location' }, // location,需求, etc.
    searchCount: { type: Number, default: 1 },
    lastSearchedAt: { type: Date, default: Date.now }
}, { collection: 'bot_self_learning_memory' });
const BotLearning = mongoose.models.BotLearning || mongoose.model('BotLearning', botLearningSchema);

// Bhopal ke common areas ki shuruati knowledge (Baaki wo khud Property DB se seekhega)
const knownBhopalAreas = [
    'arera', 'mp nagar', 'new market', 'kolar', 'ashoka garden', 'indrapuri', 
    'ayodhya', 'hoshangabad road', 'bawadiya', 'katara', 'shahpura', 'gulmohar', 
    'chuna bhatti', 'lalghati', 'bairagarh', 'sant hirdaram', 'karond', 'misrod', 
    'mandideep', 'awadhpuri', 'saket', 'alakapuri', 'govindpura', 'jahangirabad', 'tt nagar'
];

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

// 🧠 SELF-LEARNING FUNCTION: Database me jitni properties hain unke locations khud seekhna
async function learnFromDatabaseAndUser(messageText, PropertyModel) {
    try {
        // 1. Property Database se saare unique locations nikal kar seekho
        const dbLocations = await PropertyModel.distinct('location', { status: 'approved' });
        dbLocations.forEach(loc => {
            if (loc) {
                const cleanLoc = loc.toLowerCase().trim();
                if (cleanLoc && !knownBhopalAreas.includes(cleanLoc)) {
                    knownBhopalAreas.push(cleanLoc);
                }
            }
        });

        // 2. User ne jo area search kiya, uski popularity badhao (Self-Analytics)
        for (const area of knownBhopalAreas) {
            if (messageText.includes(area)) {
                await BotLearning.findOneAndUpdate(
                    { keyword: area },
                    { $inc: { searchCount: 1 },$set: { lastSearchedAt: new Date() } },
                    { upsert: true }
                );
            }
        }
    } catch (e) {
        // Silent learning
    }
}

// =========================================================================
// 📱 WHATSAPP CONNECTION & SMART BRAIN ENGINE
// =========================================================================
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
                if (!msg.message || msg.key.fromMe) return;

                const senderPhone = msg.key.remoteJid; 
                
                let m = msg.message;
                if (m.ephemeralMessage) m = m.ephemeralMessage.message;
                if (m.viewOnceMessage) m = m.viewOnceMessage.message;
                if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;

                const messageText = (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || '').toLowerCase().trim();
                if (!messageText) return;

                console.log(`📩 Message Mila: "${messageText}" from ${senderPhone}`);

                const Property = mongoose.models.Property || mongoose.model('Property');
                
                // 🧠 Bot har message par database se naye locations seekhega
                await learnFromDatabaseAndUser(messageText, Property);

                // =========================================================================
                // 🔄 STEP 1: CHECK IF USER IS REPLYING "YES / HAAN / DIKHAO" FOR ALTERNATIVES
                // =========================================================================
                const yesKeywords = ['haan', 'ha', 'hn', 'yes', 'dikhao', 'batao', 'ok', 'okay', 'sure', 'bhejo'];
                const userState = userConversationState[senderPhone];

                if (userState && userState.awaitingAlternative && yesKeywords.some(w => messageText === w || messageText.includes(w))) {
                    userConversationState[senderPhone].awaitingAlternative = false; // Reset state

                    let altFilter = { status: 'approved' };
                    // Purpose wahi rakhenge (Rent ya Sale) jo user ne maanga tha
                    if (userState.lastPurpose) {
                        altFilter.purpose = new RegExp(userState.lastPurpose, 'i');
                    }

                    // 1. Pehle koshish karenge usi area me thode upar ke budget ki property dhoondhne ki
                    let altProps = [];
                    if (userState.lastLocation) {
                        altProps = await Property.find({ 
                            ...altFilter, 
                            location: new RegExp(userState.lastLocation, 'i') 
                        }).sort({ price: 1 }).limit(3).lean();
                    }

                    // 2. Agar us area me bilkul hi nahi hai, toh aas-paas ke doosre areas ki sasti/best properties nikalenge
                    let isOtherArea = false;
                    if (altProps.length === 0) {
                        isOtherArea = true;
                        altProps = await Property.find(altFilter).sort({ price: 1 }).limit(3).lean();
                    }

                    if (altProps.length === 0) {
                        await sendDirectWhatsApp(senderPhone, `🙏 Maaf kijiyega! Abhi hamare portal par koi bhi matching property uplabdh nahi hai. Jaise hi nayi property aayegi, hum update karenge.\n🌐 Visit: https://bhopal-real-estate.onrender.com`);
                        return;
                    }

                    let altReply = `💡 *Aapke liye Best Alternative Options:*\n`;
                    if (isOtherArea && userState.lastLocation) {
                        altReply += `*(${userState.lastLocation.toUpperCase()} me uplabdh na hone ke karan Bhopal ke anya prime areas ke options)*\n\n`;
                    } else if (userState.lastBudget) {
                        altReply += `*(₹${userState.lastBudget} se thode alag budget me best options)*\n\n`;
                    } else {
                        altReply += `\n`;
                    }

                    altProps.forEach((p, idx) => {
                        altReply += `${idx + 1}. *${p.title || 'Property'}*\n📍 Area: ${p.location}\n💰 Price: ₹${p.price} (${p.purpose})\n🔗 Dekhein: https://bhopal-real-estate.onrender.com/property-details.html?id=${p._id}\n\n`;
                    });
                    altReply += `📞 Kisi bhi property ki visit ya jankari ke liye link par click karein!`;

                    await sendDirectWhatsApp(senderPhone, altReply);
                    return;
                }

                // =========================================================================
                // 👋 STEP 2: NATURAL GREETING LOGIC (Hi, Hello, GM, GE)
                // =========================================================================
                const morningGreetings = ['gm', 'good morning', 'suprabhat'];
                const eveningGreetings = ['ge', 'good evening', 'good afternoon'];
                const normalGreetings = ['hi', 'hii', 'hiii', 'hello', 'hey', 'namaste', 'hola', 'hlw'];

                if (morningGreetings.includes(messageText)) {
                    const gmMsg = `🌅 *Good Morning!* Bhopal Properties me aapka swagat hai. 😊\n\nBataiye aaj main aapki kya madad kar sakta hoon? Agar aap Rent ya Sale ke liye property dekh rahe hain, toh apना *Area* aur *Budget* likh kar bhejein (Jaise: *"Arera me 2 bhk rent under 15000"*).`;
                    await sendDirectWhatsApp(senderPhone, gmMsg);
                    return;
                }

                if (eveningGreetings.includes(messageText)) {
                    const geMsg = `🌇 *Good Evening!* Bhopal Properties me aapka swagat hai. 😊\n\nMain aapki kya madad kar sakta hoon? Property search karne ke liye apni requirement aur budget batayein (Jaise: *"Kolar me flat under 10k"*).`;
                    await sendDirectWhatsApp(senderPhone, geMsg);
                    return;
                }

                if (normalGreetings.includes(messageText)) {
                    const hiMsg = `🙏 *Namaste! Bhopal Properties me aapka swagat hai.*\n\nMain aapka Smart Property Assistant hoon. Main aapki kaise madad kar sakta hoon? 😊\n\n🏠 Property dhoondhne ke liye bas apna *Area*, *BHK* ya *Budget* likhein:\n👉 *"2 bhk rent under 12000"*\n👉 *"Ashoka Garden me flat"*\n👉 *"Plot ya House for sale"*`;
                    await sendDirectWhatsApp(senderPhone, hiMsg);
                    return;
                }

                // =========================================================================
                // 🔍 STEP 3: SMART PROPERTY SEARCH & BUDGET DETECTOR
                // =========================================================================
                const propKeywords = [
                    'bhk', 'rent', 'flat', 'sale', 'buy', 'sell', 'property', 'plot', 
                    'duplex', 'house', 'makan', 'room', 'shop', 'office', 'kiraye', 
                    'kharidna', 'chahiye', 'under', 'budget', 'tak'
                ];

                // Check karein ki kya message me koi property keyword ya Bhopal ka koi area hai
                const matchedArea = knownBhopalAreas.find(area => messageText.includes(area));
                const hasPropKeyword = propKeywords.some(kw => messageText.includes(kw));

                // 🔒 PERSONAL CHAT GUARD: Agar na property keyword hai, na Bhopal ka area, toh bot chup rahega!
                if (!hasPropKeyword && !matchedArea) {
                    return; 
                }

                let filter = { status: 'approved' };
                let detectedPurpose = null;
                let detectedBhk = null;

                // 1. Area Filter
                if (matchedArea) {
                    filter.location = new RegExp(matchedArea, 'i');
                }

                // 2. Purpose Filter (Rent vs Sale)
                if (messageText.includes('rent') || messageText.includes('kiraye') || messageText.includes('room')) {
                    filter.purpose = /rent/i;
                    detectedPurpose = 'Rent';
                } else if (messageText.includes('buy') || messageText.includes('sale') || messageText.includes('sell') || messageText.includes('kharidna') || messageText.includes('plot')) {
                    filter.purpose = /sale/i;
                    detectedPurpose = 'Sale';
                }

                // 3. BHK Filter (1 BHK, 2 BHK, 3 BHK)
                const bhkMatch = messageText.match(/(\d)\s*bhk/i);
                if (bhkMatch) {
                    detectedBhk = bhkMatch[1];
                    filter.title = new RegExp(`${detectedBhk}\\s*bhk`, 'i');
                }

                // 4. Smart Budget Extractor (Handles "under5000", "15k", "20 lakh", etc.)
                let maxBudget = null;
                const regex = /(\d+)\s*(k|lakh|l|thousand|lac)?/gi;
                let match;
                while ((match = regex.exec(messageText)) !== null) {
                    let val = parseInt(match[1]);
                    let unit = match[2] ? match[2].toLowerCase() : '';
                    if (unit === 'k' || unit === 'thousand') val *= 1000;
                    else if (unit === 'l' || unit === 'lakh' || unit === 'lac') val *= 100000;
                    
                    // 500 se bade number ko hi budget manega (taaki 2 bhk ka '2' ignore ho jaye)
                    if (val >= 500) maxBudget = val;
                }

                if (maxBudget) {
                    filter.price = { $lte: maxBudget };
                }

                // Database me exact requirement dhoondhein
                const matchedProps = await Property.find(filter).sort({ price: 1 }).limit(3).lean();

                // =========================================================================
                // ❌ STEP 4: IF NO PROPERTY FOUND -> ASK TO SHOW ALTERNATIVES
                // =========================================================================
                if (matchedProps.length === 0) {
                    // User ki requirement memory me save kar lo taaki 'Haan' bolne par dikha sakein
                    userConversationState[senderPhone] = {
                        awaitingAlternative: true,
                        lastLocation: matchedArea || null,
                        lastBudget: maxBudget || null,
                        lastPurpose: detectedPurpose || null
                    };

                    let notFoundMsg = `🙏 Namaste! Aapki requirement`;
                    if (matchedArea) notFoundMsg += ` (*${matchedArea.toUpperCase()}*)`;
                    if (maxBudget) notFoundMsg += ` *₹${maxBudget}* ke budget me`;
                    notFoundMsg += ` abhi koi property uplabdh nahi hai.\n\n`;
                    
                    notFoundMsg += `💡 *Kya main aapko is budget se thode upar ya aas-paas ke area ke best alternative options dikhaun?*\n\n👉 Dekhne ke liye bas *"Haan"* ya *"Dikhao"* likh kar reply karein!`;

                    await sendDirectWhatsApp(senderPhone, notFoundMsg);
                    return;
                }

                // =========================================================================
                // ✅ STEP 5: IF PROPERTIES FOUND -> SEND CLEAN LIST
                // =========================================================================
                userConversationState[senderPhone] = { awaitingAlternative: false };

                let replyMsg = `🏢 *Bhopal Properties Smart Assistant*\n`;
                let criteria = [];
                if (matchedArea) criteria.push(`📍 Area: ${matchedArea.toUpperCase()}`);
                if (maxBudget) criteria.push(`💰 Budget: Upto ₹${maxBudget}`);
                if (detectedPurpose) criteria.push(`📌 Type: ${detectedPurpose}`);
                
                if (criteria.length > 0) {
                    replyMsg += `*(${criteria.join(' | ')})*\n\n`;
                } else {
                    replyMsg += `Aapki talash ke anusaar yeh top properties uplabdh hain:\n\n`;
                }

                matchedProps.forEach((p, index) => {
                    replyMsg += `${index + 1}. *${p.title || 'Property'}*\n📍 Location: ${p.location}\n💰 Price: ₹${p.price}\n🔗 Dekhein: https://bhopal-real-estate.onrender.com/property-details.html?id=${p._id}\n\n`;
                });
                replyMsg += `📞 Adhik jankari ya visit ke liye link par click karein!`;

                await sendDirectWhatsApp(senderPhone, replyMsg);

            } catch (botErr) {
                console.error("WhatsApp Bot Error:", botErr);
            }
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) currentQrData = await QRCode.toDataURL(qr);
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut) {
                    await WhatsAppAuth.deleteMany({});
                    connectToWhatsApp();
                } else {
                    setTimeout(() => connectToWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                currentQrData = null;
                console.log('✅ WhatsApp Baileys Connected with Self-Learning Smart Brain!');
            }
        });
    } catch (err) {
        console.error('WhatsApp Init Error:', err.message);
    }
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
        console.log(`📤 Reply sent to ${jid}`);
        return true;
    } catch (err) { return false; }
}

function getLatestQr() { return currentQrData; }
module.exports = { connectToWhatsApp, sendDirectWhatsApp, getLatestQr };