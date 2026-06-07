const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const nodemailer = require('nodemailer'); 

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ==========================================
// 📧 NODEMAILER SETUP 
// ==========================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'YOUR_GMAIL_ID_HERE', 
        pass: 'gxzl pjvj yoxz ifzo' 
    }
});

// ==========================================
// ☁️ CLOUDINARY SETUP 
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

const pendingUserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, required: true },
    password: String,
    otp: String,
    createdAt: { type: Date, expires: '10m', default: Date.now } 
});
const PendingUser = mongoose.model('PendingUser', pendingUserSchema);

const propertySchema = new mongoose.Schema({
    title: String,
    purpose: String,
    location: String,
    price: Number,
    desc: String,
    images: [{ type: String }], // 📸 3 इमेजेस के लिए लिस्ट
    videoLink: { type: String, default: '' }, // 🚁 सिनेमैटिक वीडियो लिंक के लिए
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

// 🚀 साइन-अप सिस्टम (Render Free Tier Hack के साथ)
app.post('/api/signup', async(req, res) => {
    try {
        const { name, email, password } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) return res.status(400).json({ success: false, message: 'यह ईमेल पहले से रजिस्टर है!' });

        const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

        await PendingUser.findOneAndDelete({ email: normalizedEmail }); 
        const pendingUser = new PendingUser({ name, email: normalizedEmail, password, otp: generatedOtp });
        await pendingUser.save();

        // 🔥 Render Free Tier Hack: OTP Logs में प्रिंट होगा
        console.log(`\n========================================`);
        console.log(`🔑 नया साइन-अप: ${name} (${normalizedEmail})`);
        console.log(`🚀 आपका OTP है: ${generatedOtp}`);
        console.log(`========================================\n`);

        res.json({ success: true, message: '✅ [Test Mode] OTP जनरेट हो गया है! कृपया अपना Render Logs चेक करें।', requireOtp: true });

    } catch (error) {
        res.status(500).json({ success: false, message: 'सर्वर एरर' });
    }
});

app.post('/api/verify-otp', async(req, res) => {
    try {
        const { email, otp } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        const pendingUser = await PendingUser.findOne({ email: normalizedEmail });

        if (!pendingUser) return res.status(400).json({ success: false, message: 'OTP एक्सपायर हो गया है या ईमेल गलत है।' });
        if (pendingUser.otp !== otp) return res.status(400).json({ success: false, message: '❌ गलत OTP!' });

        const newUser = new User({ name: pendingUser.name, email: pendingUser.email, password: pendingUser.password });
        await newUser.save();
        await PendingUser.findOneAndDelete({ email: normalizedEmail });

        res.json({ success: true, message: '🎉 खाता सफलतापूर्वक बन गया है! अब आप लॉगिन कर सकते हैं।' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'OTP वेरीफाई करने में सर्वर एरर' });
    }
});

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

// 🚨 अपडेटेड रूट: यहाँ 3 इमेजेस और वीडियो लिंक सेव होगा
app.post('/api/add-property', upload.array('propertyImages', 3), async(req, res) => {
    try {
        const imageUrls = [];
        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                imageUrls.push(file.path || file.url);
            });
        }

        const newProperty = new Property({
            title: req.body.title,
            purpose: req.body.purpose,
            location: req.body.location,
            price: req.body.price,
            desc: req.body.desc,
            images: imageUrls, // 📸
            videoLink: req.body.videoLink || '', // 🚁 
            brokerEmail: req.body.brokerEmail ? req.body.brokerEmail.toLowerCase().trim() : 'unknown',
            status: 'pending' 
        });
        
        await newProperty.save();
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक अपलोड हो गई! (एडमिन अप्रूवल का इंतज़ार है)' });
    } catch (error) {
        console.error("प्रॉपर्टी अपलोड एरर:", error);
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

// Admin Routes
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
        await Property.findByIdAndUpdate(req.params.id, { status: 'approved' });
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक लाइव कर दी गई है! ✅' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'प्रॉपर्टी अप्रूव करने में सर्वर एरर' });
    }
});

app.post('/api/admin/unpublish-property/:id', async (req, res) => {
    try {
        await Property.findByIdAndUpdate(req.params.id, { status: 'pending' });
        res.json({ success: true, message: 'प्रॉपर्टी को वापस पेंडिंग कर दिया गया है! ⏸️' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'प्रॉपर्टी अनपब्लिश करने में सर्वर एरर' });
    }
});

app.delete('/api/admin/delete-property/:id', async (req, res) => {
    try {
        await Property.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक डिलीट कर दी गई!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'प्रॉपर्टी डिलीट करने में सर्वर एरर' });
    }
});

app.delete('/api/admin/delete-user/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (user) {
            await Property.deleteMany({ brokerEmail: user.email.toLowerCase().trim() });
            await BrokerProfile.deleteOne({ brokerEmail: user.email.toLowerCase().trim() });
        }
        res.json({ success: true, message: 'यूज़र और उसकी सभी प्रॉपर्टीज़ डिलीट कर दी गईं!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'यूज़र डिलीट करने में सर्वर एरर' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running LIVE on port ${PORT}`);
});