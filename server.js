const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer'); // फोटो अपलोड के लिए

const app = express();

// मिडिलवेयर (Middleware)
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// तुम्हारी HTML, CSS और JS फाइलों को ब्राउज़र तक पहुँचाने के लिए
app.use(express.static(__dirname)); 

// ==========================================
// 1️⃣ MONGODB DATABASE CONNECTION
// ==========================================
// ⚠️ पंकज भाई, नीचे वाले स्ट्रिंग को हटाकर अपना असली MongoDB URL यहाँ डालना!
const mongoURI = 'mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/?appName=Cluster0';

mongoose.connect(mongoURI)
    .then(() => console.log('✅ MongoDB Database Connected Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ==========================================
// 2️⃣ DATABASE SCHEMAS (तिजोरी का खाका)
// ==========================================
// प्रॉपर्टी का मॉडल
const propertySchema = new mongoose.Schema({
    title: String,
    purpose: String,
    location: String,
    price: Number,
    desc: String,
    image: String, 
    brokerEmail: String
}, { timestamps: true });

const Property = mongoose.model('Property', propertySchema);

// ==========================================
// 3️⃣ MULTER SETUP (फोटो अपलोड करने के लिए)
// ==========================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads'); // ध्यान दें: तुम्हारे प्रोजेक्ट में 'uploads' नाम का एक फोल्डर होना चाहिए
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'));
    }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // फोटो को पब्लिकली दिखाने के लिए

// ==========================================
// 4️⃣ API ROUTES (बैकएंड के रास्ते)
// ==========================================

// 🎯 प्राइवेसी + पब्लिक व्यू दोनों के लिए बिल्कुल फुल-प्रूफ प्रॉपर्टी गेट रूट
app.get('/api/get-properties', async (req, res) => {
    try {
        const brokerEmail = req.query.email;
        let properties = [];
        
        // 🛡️ चेक करें कि ईमेल सच में मौजूद है और वैलिड है (डैशबोर्ड के लिए)
        if (brokerEmail && brokerEmail.trim() !== "" && brokerEmail !== "undefined") {
            properties = await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() });
        } else {
            // 🌐 अगर ईमेल नहीं है या खाली है, तो बिना किसी फ़िल्टर के सारी प्रॉपर्टीज दिखाओ (मेन पेज के लिए)
            properties = await Property.find({});
        }
        
        res.json(properties);
    } catch (error) {
        console.error("डेटाबेस फ़ेच एरर:", error);
        res.status(500).json({ message: 'डेटा लाने में गड़बड़ हुई' });
    }
});

// 📝 नई प्रॉपर्टी अपलोड करने का रूट
app.post('/api/add-property', upload.single('propertyImage'), async (req, res) => {
    try {
        const newProperty = new Property({
            title: req.body.title,
            purpose: req.body.purpose,
            location: req.body.location,
            price: req.body.price,
            desc: req.body.desc,
            image: req.file ? '/uploads/' + req.file.filename : '', // फोटो का लिंक
            brokerEmail: req.body.brokerEmail ? req.body.brokerEmail.toLowerCase().trim() : 'unknown'
        });
        
        await newProperty.save();
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक अपलोड हो गई!' });
    } catch (error) {
        console.error("प्रॉपर्टी अपलोड एरर:", error);
        res.status(500).json({ success: false, message: 'प्रॉपर्टी अपलोड करने में गड़बड़ हुई' });
    }
});

// ⚠️ नोट: अगर तुम्हारे पास पहले से Login/Signup के लिए API (`/api/login` आदि) थे, 
// तो उन्हें यहाँ नीचे पेस्ट कर लेना।

// ==========================================
// 5️⃣ SERVER START
// ==========================================
// Render सर्वर के लिए पोर्ट सेटअप
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running LIVE on port ${PORT}`);
});