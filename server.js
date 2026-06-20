const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Razorpay = require('razorpay');
const crypto = require('crypto'); // Payment verify karne ke liye
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

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
    params: { folder: 'bhopal_properties', allowedFormats: ['jpg', 'png', 'jpeg', 'webp'] }
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
    name: String, email: { type: String, unique: true, required: true }, 
    password: { type: String, required: true }, role: { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

const pendingUserSchema = new mongoose.Schema({
    name: String, email: { type: String, required: true }, password: String, otp: String,
    createdAt: { type: Date, expires: '10m', default: Date.now } 
});
const PendingUser = mongoose.model('PendingUser', pendingUserSchema);

const propertySchema = new mongoose.Schema({
    title: String, purpose: String, location: String, price: Number, desc: String,
    images: [{ type: String }], videoLink: { type: String, default: '' }, 
    brokerEmail: String, status: { type: String, default: 'pending' },
    views: { type: Number, default: 0 }, clicks: { type: Number, default: 0 } 
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);

const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String, photo: String, dealingAreas: [String]
}, { timestamps: true });
const BrokerProfile = mongoose.model('BrokerProfile', brokerProfileSchema);

// ==========================================
// 3️⃣ API ROUTES
// ==========================================

app.get('/api/get-property/:id', async (req, res) => {
    try {
        const property = await Property.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
        if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
        const brokerProfile = await BrokerProfile.findOne({ brokerEmail: property.brokerEmail });
        res.json({ success: true, property: property, brokerProfile: brokerProfile });
    } catch (error) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/track-click/:id', async (req, res) => {
    try {
        await Property.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/add-property', upload.array('propertyImages', 3), async(req, res) => {
    try {
        const imageUrls = req.files ? req.files.map(f => f.path || f.url) : [];
        const newProperty = new Property({ ...req.body, images: imageUrls, brokerEmail: req.body.brokerEmail ? req.body.brokerEmail.toLowerCase().trim() : 'unknown' });
        await newProperty.save();
        res.json({ success: true, message: 'Uploaded Successfully' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/update-property/:id', upload.array('propertyImages', 3), async (req, res) => {
    try {
        const updateData = { ...req.body };
        if (req.files && req.files.length > 0) updateData.images = req.files.map(f => f.path || f.url);
        await Property.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true, message: 'Updated Successfully' });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/get-properties', async(req, res) => {
    try {
        const brokerEmail = req.query.email;
        const properties = (brokerEmail && brokerEmail !== "undefined") 
            ? await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() }) 
            : await Property.find({ status: 'approved' });
        res.json(properties);
    } catch (error) { res.status(500).json({ message: 'Error fetching data' }); }
});

app.get('/api/get-profile', async(req, res) => {
    try {
        const email = req.query.email;
        let profile = await BrokerProfile.findOne({ brokerEmail: email.toLowerCase().trim() });
        res.json(profile || { brokerEmail: email, phone: '', photo: '', dealingAreas: [] });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});
// ==========================================
// 💸 RAZORPAY PAYMENT ROUTES (For ₹10 Property Listing)
// ==========================================

// Razorpay Setup (Yahan apni test keys dalein)
const razorpay = new Razorpay({
    key_id: 'YOUR_KEY_ID',       // 👈 Yahan apni Key ID dalein
    key_secret: 'YOUR_KEY_SECRET' // 👈 Yahan apna Key Secret dalein
});

// 1. Order Create Karne ki API
app.post('/api/create-order', async (req, res) => {
    try {
        const options = {
            amount: 1000, // ₹10 (Razorpay paise mein count karta hai, isliye 10 * 100 = 1000)
            currency: "INR",
            receipt: "receipt_" + Math.random().toString(36).substring(7)
        };
        const order = await razorpay.orders.create(options);
        res.json({ success: true, order });
    } catch (error) {
        console.error("Order Creation Error:", error);
        res.status(500).json({ success: false, message: 'Payment gateway error!' });
    }
});

// 2. Payment Verify Karne ki API
app.post('/api/verify-payment', (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        
        // Security check: Signature match karna
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", "YOUR_KEY_SECRET") // 👈 Yahan wapas apna Key Secret dalein
            .update(sign.toString())
            .digest("hex");

        if (razorpay_signature === expectedSign) {
            return res.json({ success: true, message: "Payment Verified Successfully!" });
        } else {
            return res.status(400).json({ success: false, message: "Payment Verification Failed!" });
        }
    } catch (error) {
        console.error("Verification Error:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});
// ==========================================
// 👤 PROFILE UPDATE ROUTE
// ==========================================
app.post('/api/update-profile', upload.single('profilePhoto'), async (req, res) => {
    try {
        const { brokerEmail, phone } = req.body;
        
        let areas = [];
        if (req.body.dealingAreas) {
            try {
                areas = JSON.parse(req.body.dealingAreas); 
            } catch (e) {
                areas = Array.isArray(req.body.dealingAreas) ? req.body.dealingAreas : req.body.dealingAreas.split(',');
            }
        }

        const updateData = { phone: phone, dealingAreas: areas };
        
        if (req.file) {
            updateData.photo = req.file.path || req.file.url;
        }

        await BrokerProfile.findOneAndUpdate(
            { brokerEmail: brokerEmail.toLowerCase().trim() },
            { $set: updateData },
            { new: true, upsert: true } 
        );

        res.json({ success: true, message: 'Profile Saved Successfully!' });
    } catch (error) {
        console.error("Profile Update Error:", error);
        res.status(500).json({ success: false, message: 'Server Error saving profile' });
    }
});

// ==========================================
// 🔑 AUTHENTICATION ROUTES (Signup & Login)
// ==========================================

app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const emailLower = email.toLowerCase().trim();

        const existingUser = await User.findOne({ email: emailLower });
        if (existingUser) return res.status(400).json({ success: false, message: 'Email is already registered!' });

        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        await PendingUser.deleteMany({ email: emailLower });
        const newPendingUser = new PendingUser({ name, email: emailLower, password, otp });
        await newPendingUser.save();

        console.log(`🔑 OTP for ${emailLower} is: [ ${otp} ]`);
        res.json({ success: true, requireOtp: true, generatedOtp: otp, message: 'OTP Generated successfully.' });
    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).json({ success: false, message: 'Server error during signup.' });
    }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const emailLower = email.toLowerCase().trim();

        const pendingUser = await PendingUser.findOne({ email: emailLower });
        if (!pendingUser) return res.status(400).json({ success: false, message: 'OTP expired or invalid email.' });

        if (pendingUser.otp !== otp) return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });

        const newUser = new User({ name: pendingUser.name, email: pendingUser.email, password: pendingUser.password, role: 'user' });
        await newUser.save();
        await PendingUser.deleteOne({ email: emailLower });

        res.json({ success: true, message: 'Account verified and created successfully!' });
    } catch (error) {
        console.error("Verify Error:", error);
        res.status(500).json({ success: false, message: 'Server error during verification.' });
    }
});

app.post('/api/login', async(req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim(), password });
        if (user) res.json({ success: true, name: user.name, email: user.email, role: user.email === "devilking786k@sahu.com" ? 'admin' : 'user' });
        else res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (error) { res.status(500).json({ success: false }); }
});

// ==========================================
// 👑 ADMIN API ROUTES
// ==========================================

app.get('/api/admin/all-data', async (req, res) => {
    try {
        const users = await User.find({});
        const properties = await Property.find({});
        res.json({ success: true, totalUsers: users.length, totalProperties: properties.length, users, properties });
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
});

app.post('/api/admin/approve-property/:id', async (req, res) => {
    try {
        await Property.findByIdAndUpdate(req.params.id, { status: 'approved' });
        res.json({ success: true, message: 'Property Published Successfully!' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/unpublish-property/:id', async (req, res) => {
    try {
        await Property.findByIdAndUpdate(req.params.id, { status: 'pending' });
        res.json({ success: true, message: 'Property Unpublished!' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.delete('/api/admin/delete-property/:id', async (req, res) => {
    try { await Property.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false }); }
});

app.delete('/api/admin/delete-user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            await Property.deleteMany({ brokerEmail: user.email });
            await User.findByIdAndDelete(req.params.id);
            res.json({ success: true, message: 'User and their properties deleted!' });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) { res.status(500).json({ success: false }); }
});

// 🚨 SERVER START (यह हमेशा सबसे नीचे होना चाहिए)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is LIVE on port ${PORT}`));