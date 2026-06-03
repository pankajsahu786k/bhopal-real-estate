const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer'); // फोटो अपलोड के लिए

const app = express();

// ==========================================
// ⚙️ मिडिलवेयर (Middleware)
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname)); // HTML, CSS और JS फाइलों के लिए

// ==========================================
// 1️⃣ MONGODB DATABASE CONNECTION
// ==========================================
const mongoURI = 'mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/?appName=Cluster0';

mongoose.connect(mongoURI)
    .then(() => console.log('✅ MongoDB Database Connected Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));


// ==========================================
// 2️⃣ DATABASE SCHEMAS (तिजोरी के खाके)
// ==========================================

// 🧑‍💼 1. यूज़र अकाउंट (Login/Signup) मॉडल
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// 🏠 2. प्रॉपर्टी का मॉडल
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

// 📨 3. कस्टमर मैसेज (Enquiry) का मॉडल
const enquirySchema = new mongoose.Schema({
    propertyId: String,
    propertyTitle: String,
    ownerEmail: String,
    customerName: String,
    customerPhone: String,
    message: String
}, { timestamps: true });
const Enquiry = mongoose.model('Enquiry', enquirySchema);

// 👤 4. ब्रोकर प्रोफाइल का मॉडल
const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String,
    photo: String,
    dealingAreas: [String] // भोपाल के चुने हुए इलाके
}, { timestamps: true });
const BrokerProfile = mongoose.model('BrokerProfile', brokerProfileSchema);


// ==========================================
// 3️⃣ MULTER SETUP (फोटो अपलोड करने के लिए)
// ==========================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads'); // 'uploads' नाम का फोल्डर होना चाहिए
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'));
    }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // फोटो दिखाने के लिए


// ==========================================
// 4️⃣ API ROUTES (बैकएंड के सारे रास्ते)
// ==========================================

// ------------------------------------------
// 🔐 LOGIN / SIGNUP ROUTES
// ------------------------------------------
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
        if (existingUser) return res.status(400).json({ success: false, message: 'यह ईमेल पहले से रजिस्टर है!' });
        
        const newUser = new User({ name, email: email.toLowerCase().trim(), password });
        await newUser.save();
        res.json({ success: true, message: 'खाता सफलतापूर्वक बन गया! अब आप लॉगिन कर सकते हैं।' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'साइन-अप में सर्वर एरर' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim(), password });
        if (user) {
            res.json({ success: true, name: user.name, email: user.email });
        } else {
            res.status(401).json({ success: false, message: 'गलत ईमेल या पासवर्ड' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'लॉगिन में सर्वर एरर' });
    }
});

// ------------------------------------------
// 🏠 PROPERTY ROUTES (Add, Get, Update, Delete)
// ------------------------------------------
app.get('/api/get-properties', async (req, res) => {
    try {
        const brokerEmail = req.query.email;
        let properties = [];
        // 🔒 अगर ईमेल है (डैशबोर्ड) तो सिर्फ उसकी प्रॉपर्टी दिखाओ, वर्ना पब्लिक के लिए सारी दिखाओ
        if (brokerEmail && brokerEmail.trim() !== "" && brokerEmail !== "undefined") {
            properties = await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() });
        } else {
            properties = await Property.find({});
        }
        res.json(properties);
    } catch (error) {
        res.status(500).json({ message: 'डेटा लाने में गड़बड़ हुई' });
    }
});

app.post('/api/add-property', upload.single('propertyImage'), async (req, res) => {
    try {
        const newProperty = new Property({
            title: req.body.title,
            purpose: req.body.purpose,
            location: req.body.location,
            price: req.body.price,
            desc: req.body.desc,
            image: req.file ? '/uploads/' + req.file.filename : '', 
            brokerEmail: req.body.brokerEmail ? req.body.brokerEmail.toLowerCase().trim() : 'unknown'
        });
        await newProperty.save();
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक अपलोड हो गई!' });
    } catch (error) {
        res.status(500).json({ success: false, message