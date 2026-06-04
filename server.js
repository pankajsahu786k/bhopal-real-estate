const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();

// ==========================================
// ⚙️ मिडिलवेयर (Middleware)
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ==========================================
// 1️⃣ MONGODB DATABASE CONNECTION
// ==========================================
const mongoURI = 'mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/?appName=Cluster0';

mongoose.connect(mongoURI, { family: 4 })
    .then(() => console.log('✅ MongoDB Database Connected Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ==========================================
// 2️⃣ DATABASE SCHEMAS (तिजोरी के खाके)
// ==========================================
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

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

const enquirySchema = new mongoose.Schema({
    propertyId: String,
    propertyTitle: String,
    ownerEmail: String,
    customerName: String,
    customerPhone: String,
    message: String
}, { timestamps: true });
const Enquiry = mongoose.model('Enquiry', enquirySchema);

const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String,
    photo: String,
    dealingAreas: [String]
}, { timestamps: true });
const BrokerProfile = mongoose.model('BrokerProfile', brokerProfileSchema);

// ==========================================
// 3️⃣ MULTER SETUP (फोटो अपलोड करने के लिए)
// ==========================================
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, './uploads');
    },
    filename: function(req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'));
    }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==========================================
// 4️⃣ API ROUTES (बैकएंड के सारे रास्ते)
// ==========================================
app.post('/api/signup', async(req, res) => {
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

app.post('/api/login', async(req, res) => {
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

app.get('/api/get-properties', async(req, res) => {
    try {
        const brokerEmail = req.query.email;
        let properties = [];
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

app.post('/api/add-property', upload.single('propertyImage'), async(req, res) => {
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
        res.status(500).json({ success: false, message: 'प्रॉपर्टी अपलोड करने में सर्वर एरर' });
    }
});

app.get('/api/get-profile', async(req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ message: 'Email ज़रूरी है' });

        let profile = await BrokerProfile.findOne({ brokerEmail: email.toLowerCase().trim() });
        if (!profile) {
            profile = { brokerEmail: email, phone: '', photo: '', dealingAreas: [] };
        }
        res.json(profile);
    } catch (error) {
        res.status(500).json({ message: 'Profile data लाने में दिक्कत हुई' });
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
        if (req.file) profile.photo = '/uploads/' + req.file.filename;

        await profile.save();
        res.json({ success: true, message: 'Profile कामयाबी से अपडेट हो गई!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Profile अपडेट सर्वर एरर' });
    }
});

// ==========================================
// 5️⃣ SERVER START
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running LIVE on port ${PORT}`);
});

// 👉 पंकज भाई, चेक करना कि यहां तक कॉपी हुआ है या नहीं 👈