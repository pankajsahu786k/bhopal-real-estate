const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const nodemailer = require('nodemailer'); // 👈 नया टूल (Nodemailer)

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ==========================================
// 📧 NODEMAILER SETUP (ईमेल भेजने वाला डाकिया)
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'pankajsahu786k@gmail.com', // 👈 अपना असली Gmail यहाँ डालें
        pass: 'gxzl pjvj yoxz ifzo' // आपका App Password
    }
});

// ==========================================
// ☁️ CLOUDINARY SETUP (फोटो की तिजोरी)
// ==========================================
cloudinary.config({
    cloud_name: 'duy3ipjoj',
    api_key: '228275812572669',
    api_secret: '0VVartpd4kavLNXs66kmCAmUeCI'
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'bhopal_properties',
        allowedFormats: ['jpg', 'png', 'jpeg', 'webp']
    }
});
const upload = multer({ storage: storage });

// ==========================================
// 1️⃣ MONGODB DATABASE CONNECTION
// ==========================================
const mongoURI = 'mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/?appName=Cluster0';

mongoose.connect(mongoURI, { family: 4 })
    .then(() => console.log('✅ MongoDB Database Connected Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ==========================================
// 2️⃣ DATABASE SCHEMAS
// ==========================================
const userSchema = new mongoose.Schema({
    name: String, 
    email: { type: String, unique: true, required: true }, 
    password: { type: String, required: true },
    role: { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

// 🛡️ नया: Pending User Schema (OTP चेक करने के लिए 10 मिनट का कच्चा खाता)
const pendingUserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true },
    password: String,
    otp: String,
    createdAt: { type: Date, expires: '10m', default: Date.now } // 10 मिनट बाद अपने आप डिलीट
});
const PendingUser = mongoose.model('PendingUser', pendingUserSchema);

const propertySchema = new mongoose.Schema({
    title: String,
    purpose: String,
    location: String,
    price: Number,
    desc: String,
    image: String,
    brokerEmail: String,
    status: { type: String, default: 'pending' } 
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);

const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String,
    photo: String,
    dealingAreas: [String]
}, { timestamps: true });
const BrokerProfile = mongoose.model('BrokerProfile', brokerProfileSchema);

// ==========================================
// 4️⃣ API ROUTES
// ==========================================

// 🚀 नया साइन-अप सिस्टम (OTP जनरेट करके भेजना)
app.post('/api/signup', async(req, res) => {
    try {
        const { name, email, password } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        // 1. चेक करें कि यूज़र पहले से तो नहीं है
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) return res.status(400).json({ success: false, message: 'यह ईमेल पहले से रजिस्टर है!' });

        // 2. नया 4-डिजिट OTP बनाएं
        const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // 3. कच्चे खाते (PendingUser) में सेव करें
        await PendingUser.findOneAndDelete({ email: normalizedEmail }); // अगर पुराना OTP पड़ा हो तो हटा दें
        const pendingUser = new PendingUser({ name, email: normalizedEmail, password, otp: generatedOtp });
        await pendingUser.save();

        // 4. ईमेल भेजें
        const mailOptions = {
            from: 'Bhopal Real Estate Admin',
            to: normalizedEmail,
            subject: 'Your Account Verification OTP',
            html: `<h3>Bhopal Real Estate में आपका स्वागत है!</h3>
                   <p>आपका अकाउंट वेरीफाई करने के लिए OTP है: <b><span style="font-size:24px; color:blue;">${generatedOtp}</span></b></p>
                   <p>यह OTP 10 मिनट के लिए मान्य है।</p>`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("ईमेल भेजने में एरर:", error);
                return res.status(500).json({ success: false, message: 'OTP भेजने में समस्या आई। ईमेल चेक करें।' });
            }
            res.json({ success: true, message: '✅ आपके ईमेल पर OTP भेज दिया गया है!', requireOtp: true });
        });

    } catch (error) {
        res.status(500).json({ success: false, message: 'सर्वर एरर' });
    }
});

// 🚀 नया रूट: OTP वेरीफाई करके असली अकाउंट बनाना
app.post('/api/verify-otp', async(req, res) => {
    try {
        const { email, otp } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        // कच्चे खाते में यूज़र और OTP चेक करें
        const pendingUser = await PendingUser.findOne({ email: normalizedEmail });

        if (!pendingUser) return res.status(400).json({ success: false, message: 'OTP एक्सपायर हो गया है या ईमेल गलत है। फिर से साइन-अप करें।' });
        if (pendingUser.otp !== otp) return res.status(400).json({ success: false, message: '❌ गलत OTP! कृपया सही कोड डालें।' });

        // OTP सही है! अब असली अकाउंट (User) बना दें
        const newUser = new User({ 
            name: pendingUser.name, 
            email: pendingUser.email, 
            password: pendingUser.password 
        });
        await newUser.save();

        // कच्चे खाते से डिलीट कर दें
        await PendingUser.findOneAndDelete({ email: normalizedEmail });

        res.json({ success: true, message: '🎉 खाता सफलतापूर्वक बन गया है! अब आप लॉगिन कर सकते हैं।' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'OTP वेरीफाई करने में सर्वर एरर' });
    }
});

// लॉगिन
app.post('/api/login', async(req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim(), password });
        
        if (user) {
            let userRole = user.role || 'user';
            const adminEmail = "devilking786k@sahu.com"; 
            if (user.email === adminEmail.toLowerCase().trim()) {
                userRole = 'admin';
            }
            res.json({ success: true, name: user.name, email: user.email, role: userRole }); 
        } else {
            res.status(401).json({ success: false, message: 'गलत ईमेल या पासवर्ड' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'सर्वर एरर' });
    }
});

// 🚨 प्रॉपर्टीज भेजना
app.get('/api/get-properties', async(req, res) => {
    try {
        const brokerEmail = req.query.email;
        let properties = [];
        
        if (brokerEmail && brokerEmail.trim() !== "" && brokerEmail !== "undefined") {
            properties = await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() });
        } else {
            properties = await Property.find({ status: 'approved' }); 
        }
        res.json(properties);
    } catch (error) { res.status(500).json({ message: 'डेटा लाने में गड़बड़ हुई' }); }
});

app.get('/api/get-locations', async (req, res) => {
    try {
        const locations = await Property.distinct('location', { status: 'approved' });
        res.json({ success: true, locations: locations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'लोकेशन लाने में एरर' });
    }
});

app.get('/api/get-profile', async(req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ message: 'Email ज़रूरी है' });
        let profile = await BrokerProfile.findOne({ brokerEmail: email.toLowerCase().trim() });
        if (!profile) profile = { brokerEmail: email, phone: '', photo: '', dealingAreas: [] };
        res.json(profile);
    } catch (error) { res.status(500).json({ message: 'Profile data लाने में दिक्कत हुई' }); }
});

app.get('/api/get-property/:id', async (req, res) => {
    try {
        const propertyId = req.params.id;
        const property = await Property.findById(propertyId);
        if (!property) return res.status(404).json({ success: false, message: 'प्रॉपर्टी नहीं मिली!' });
        const brokerProfile = await BrokerProfile.findOne({ brokerEmail: property.brokerEmail });
        res.json({ success: true, property: property, brokerProfile: brokerProfile });
    } catch (error) {
        res.status(500).json({ success: false, message: 'सर्वर एरर' });
    }
});

app.post('/api/add-property', upload.single('propertyImage'), async(req, res) => {
    try {
        const newProperty = new Property({
            title: req.body.title,
            purpose: req.body.purpose,
            location: req.body.location,
            price: req.body.price,
            desc: req.body.desc,
            image: req.file ? (req.file.path || req.file.url) : '',
            brokerEmail: req.body.brokerEmail ? req.body.brokerEmail.toLowerCase().trim() : 'unknown',
            status: 'pending' 
        });
        await newProperty.save();
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक अपलोड हो गई! (एडमिन के अप्रूवल का इंतज़ार है)' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'प्रॉपर्टी अपलोड करने में सर्वर एरर' });
    }
});

app.post('/api/update-profile', upload.single('brokerPhoto'), async(req, res) => {
    try {
        const email = req.body.brokerEmail.toLowerCase().trim();
        const dealingAreas = req.body.dealingAreas ? req.body.dealingAreas.split(',') : [];
        let profile = await BrokerProfile.findOne({ brokerEmail: email });
        if (!profile) profile = new BrokerProfile({ brokerEmail: email });
        profile.phone = req.body.phone;
        profile.dealingAreas = dealingAreas;
        if (req.file) profile.photo = (req.file.path || req.file.url);
        await profile.save();
        res.json({ success: true, message: 'Profile कामयाबी से अपडेट हो गई!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Profile अपडेट सर्वर एरर' });
    }
});

// ==========================================
// 👑 ADMIN API ROUTES
// ==========================================
app.get('/api/admin/all-data', async (req, res) => {
    try {
        const users = await User.find({}, '-password').sort({ createdAt: -1 });
        const properties = await Property.find().sort({ createdAt: -1 }); 
        res.json({ success: true, totalUsers: users.length, totalProperties: properties.length, properties: properties, users: users });
    } catch (error) {
        res.status(500).json({ success: false, message: 'डेटा लाने में दिक्कत हुई' });
    }
});

app.post('/api/admin/approve-property/:id', async (req, res) => {
    try {
        const propertyId = req.params.id;
        await Property.findByIdAndUpdate(propertyId, { status: 'approved' });
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक लाइव कर दी गई है! ✅' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'प्रॉपर्टी अप्रूव करने में सर्वर एरर' });
    }
});

app.post('/api/admin/unpublish-property/:id', async (req, res) => {
    try {
        const propertyId = req.params.id;
        await Property.findByIdAndUpdate(propertyId, { status: 'pending' });
        res.json({ success: true, message: 'प्रॉपर्टी को वापस पेंडिंग कर दिया गया है! ⏸️ (यह होमपेज से हट गई है)' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'प्रॉपर्टी अनपब्लिश करने में सर्वर एरर' });
    }
});

app.delete('/api/admin/delete-property/:id', async (req, res) => {
    try {
        const propertyId = req.params.id;
        await Property.findByIdAndDelete(propertyId);
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक डिलीट कर दी गई!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'प्रॉपर्टी डिलीट करने में सर्वर एरर' });
    }
});

app.delete('/api/admin/delete-user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findByIdAndDelete(userId);
        if (user) {
            await Property.deleteMany({ brokerEmail: user.email.toLowerCase().trim() });
            await BrokerProfile.deleteOne({ brokerEmail: user.email.toLowerCase().trim() });
        }
        res.json({ success: true, message: 'यूज़र और उसकी सभी प्रॉपर्टीज़ डिलीट कर दी गईं!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'यूज़र डिलीट करने में सर्वर एरर' });
    }
});

app.use((err, req, res, next) => {
    console.error("🔥🔥🔥 असली एरर यहाँ फंसा है (REAL ERROR) 🔥🔥🔥");
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running LIVE on port ${PORT}`);
});