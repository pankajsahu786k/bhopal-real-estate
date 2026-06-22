const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Razorpay = require('razorpay');
const crypto = require('crypto'); 
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ==========================================
// ☁️ CLOUDINARY SETUP (PDF CORRUPTION FIX)
// ==========================================
cloudinary.config({
    cloud_name: 'duy3ipjoj',
    api_key: '228275812572669',
    api_secret: '0VVartpd4kavLNXs66kmCAmUeCI'
});

// 🚨 PERFECT PDF & IMAGE STORAGE LOGIC 🚨
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        // 📄 Agar file PDF hai, toh direct params bypass karke raw resource type set karein
        if (file.mimetype === 'application/pdf') {
            return {
                folder: 'bhopal_properties_docs',
                resource_type: 'raw', // 👈 Yeh PDF ko bina corrupt kiye save karega
                public_id: file.originalname.split('.')[0] + '_' + Date.now() // Unique naam dena zaroori hai
            };
        }
        // 📷 Agar photo hai, toh normal image format me save karo
        return {
            folder: 'bhopal_properties',
            allowedFormats: ['jpg', 'png', 'jpeg', 'webp']
        };
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
    brokerEmail: String, contactNumber: String, status: { type: String, default: 'pending' },
    views: { type: Number, default: 0 }, clicks: { type: Number, default: 0 } 
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);

const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String, photo: String, dealingAreas: [String]
}, { timestamps: true });
const BrokerProfile = mongoose.model('BrokerProfile', brokerProfileSchema);

const verificationSchema = new mongoose.Schema({
    userEmail: String,      // Kis User ne form bhara
    documentUrl: String,    // Agent dwara upload ki gayi PDF
    tenantName: String,
    tenantPhone: String,
    aadharNumber: String,
    tenantPermanentAddress: String, 
    permanentPoliceStation: String, 
    propertyAddress: String,
    currentPoliceStation: String,   
    ownerName: String,
    ownerPhone: String,
    tenantPhoto: String,    
    familyMembers: Number,  
    status: { type: String, default: 'Pending' }
}, { timestamps: true });
const Verification = mongoose.model('Verification', verificationSchema);


// ==========================================
// 3️⃣ API ROUTES
// ==========================================

// -- USER APIs --

app.post('/api/submit-verification', upload.single('tenantPhoto'), async (req, res) => {
    try {
        const photoUrl = req.file ? (req.file.path || req.file.url) : 'https://placehold.co/150x150?text=No+Photo';
        const verificationData = { ...req.body, tenantPhoto: photoUrl };
        const newRequest = new Verification(verificationData);
        await newRequest.save();

        // 🌟 NEW LOGIC: Jo bhi profile sabse pehle ya latest update hui hai, uska number uthao
        // Isse aap kisi bhi email se profile update karenge, system vahi number utha lega!
        const latestProfile = await BrokerProfile.findOne({}).sort({ updatedAt: -1 });

        let activeAgentPhone = "919575611622"; // Purana default fallback

        if (latestProfile && latestProfile.phone) {
            // Number saaf karke sirf digits rakhna
            activeAgentPhone = latestProfile.phone.replace(/\D/g, '');
            
            // Agar 10 digit ka number hai toh aage 91 jodh dena
            if (activeAgentPhone.length === 10) {
                activeAgentPhone = "91" + activeAgentPhone;
            }
        }

        res.json({ 
            success: true, 
            message: '✅ आपकी रिक्वेस्ट सफलतापूर्ण सबमिट हो गई है!',
            agentPhone: activeAgentPhone // 👈 Ab ye aapka 9993352339 wala ya jo bhi active hoga vahi bhejega
        });
    } catch (error) { 
        console.error("Verification error:", error);
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
});

app.get('/api/my-verifications', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.json({ success: false });
        const requests = await Verification.find({ userEmail: email.toLowerCase().trim() }).sort({ createdAt: -1 });
        res.json({ success: true, requests });
    } catch (error) { res.status(500).json({ success: false }); }
});


// -- POLICE AGENT APIs --

app.get('/api/admin/verifications', async (req, res) => {
    try {
        // 🚨 FIXED LOGIC: Ab agent ko sirf 'Pending' requests hi dikhengi, 'Done' wali chhup jayengi!
        const requests = await Verification.find({ status: 'Pending' }).sort({ createdAt: -1 }); 
        res.json({ success: true, requests });
    } catch (error) { 
        res.status(500).json({ success: false }); 
    }
});

app.post('/api/admin/upload-verification-doc/:id', upload.single('verificationDoc'), async (req, res) => {
    try {
        const docUrl = req.file ? (req.file.path || req.file.url) : '';
        await Verification.findByIdAndUpdate(req.params.id, { status: 'Done', documentUrl: docUrl });
        res.json({ success: true, message: '✅ PDF Uploaded and Status marked as Done!' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/change-verification-status/:id', async (req, res) => {
    try {
        await Verification.findByIdAndUpdate(req.params.id, { status: req.body.newStatus });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// -- BAAKI PURANE APIs --
app.get('/api/get-property/:id', async (req, res) => {
    try {
        const property = await Property.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
        if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
        const brokerProfile = await BrokerProfile.findOne({ brokerEmail: property.brokerEmail });
        res.json({ success: true, property: property, brokerProfile: brokerProfile });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/track-click/:id', async (req, res) => {
    try { await Property.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } }); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ success: false }); }
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
        const properties = (brokerEmail && brokerEmail !== "undefined") ? await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() }) : await Property.find({ status: 'approved' });
        res.json(properties);
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});

app.get('/api/get-profile', async(req, res) => {
    try {
        const email = req.query.email;
        let profile = await BrokerProfile.findOne({ brokerEmail: email.toLowerCase().trim() });
        res.json(profile || { brokerEmail: email, phone: '', photo: '', dealingAreas: [] });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});

// RAZORPAY
const razorpay = new Razorpay({ key_id: 'rzp_test_T3oTzNzTDvWgUL', key_secret: '8VyNa1vXyBiGjtbp5j3DRVr2' });
app.post('/api/create-order', async (req, res) => {
    try {
        const order = await razorpay.orders.create({ amount: 1000, currency: "INR", receipt: "receipt_" + Math.random().toString(36).substring(7) });
        res.json({ success: true, order });
    } catch (error) { res.status(500).json({ success: false }); }
});
app.post('/api/verify-payment', (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto.createHmac("sha256", "8VyNa1vXyBiGjtbp5j3DRVr2").update(sign.toString()).digest("hex");
        if (razorpay_signature === expectedSign) return res.json({ success: true, message: "Verified!" });
        else return res.status(400).json({ success: false });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/update-profile', upload.single('profilePhoto'), async (req, res) => {
    try {
        const { brokerEmail, phone } = req.body;
        let areas = [];
        if (req.body.dealingAreas) {
            try { areas = JSON.parse(req.body.dealingAreas); } catch (e) { areas = Array.isArray(req.body.dealingAreas) ? req.body.dealingAreas : req.body.dealingAreas.split(','); }
        }
        const updateData = { phone: phone, dealingAreas: areas };
        if (req.file) updateData.photo = req.file.path || req.file.url;
        await BrokerProfile.findOneAndUpdate({ brokerEmail: brokerEmail.toLowerCase().trim() }, { $set: updateData }, { new: true, upsert: true });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const emailLower = email.toLowerCase().trim();
        const existingUser = await User.findOne({ email: emailLower });
        if (existingUser) return res.status(400).json({ success: false, message: 'Email registered!' });
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        await PendingUser.deleteMany({ email: emailLower });
        const newPendingUser = new PendingUser({ name, email: emailLower, password, otp });
        await newPendingUser.save();
        console.log(`🔑 OTP for ${emailLower} is: [ ${otp} ]`);
        res.json({ success: true, requireOtp: true, generatedOtp: otp });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const emailLower = email.toLowerCase().trim();
        const pendingUser = await PendingUser.findOne({ email: emailLower });
        if (!pendingUser) return res.status(400).json({ success: false });
        if (pendingUser.otp !== otp) return res.status(400).json({ success: false });
        const newUser = new User({ name: pendingUser.name, email: pendingUser.email, password: pendingUser.password, role: 'user' });
        await newUser.save();
        await PendingUser.deleteOne({ email: emailLower });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/login', async(req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim(), password });
        if (user) {
            let actualRole = user.role || 'user';
            if (user.email === "devilking786k@sahu.com") actualRole = 'admin';
            res.json({ success: true, name: user.name, email: user.email, role: actualRole });
        } else {
            res.status(401).json({ success: false });
        }
    } catch (error) { res.status(500).json({ success: false }); }
});

// ADMIN APIs
app.get('/api/admin/all-data', async (req, res) => {
    try {
        const users = await User.find({});
        const properties = await Property.find({});
        res.json({ success: true, totalUsers: users.length, totalProperties: properties.length, users, properties });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/change-role/:id', async (req, res) => {
    try { await User.findByIdAndUpdate(req.params.id, { role: req.body.newRole }); res.json({ success: true, message: `Role updated to ${req.body.newRole}!` }); } 
    catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/approve-property/:id', async (req, res) => {
    try { await Property.findByIdAndUpdate(req.params.id, { status: 'approved' }); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/unpublish-property/:id', async (req, res) => {
    try { await Property.findByIdAndUpdate(req.params.id, { status: 'pending' }); res.json({ success: true }); } catch (error) { res.status(500).json({ success: false }); }
});

// ==========================================
// 🗑️ SMART DELETE APIs (Deletes from DB + Cloudinary)
// ==========================================
app.delete('/api/admin/delete-property/:id', async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (property && property.images && property.images.length > 0) {
            for (const imgUrl of property.images) {
                try {
                    const publicId = imgUrl.split('/').slice(-2).join('/').split('.')[0];
                    await cloudinary.uploader.destroy(publicId);
                } catch(e) { console.log("Cloudinary image delete error:", e); }
            }
        }
        await Property.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Property and photos deleted permanently!' });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.delete('/api/admin/delete-user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            const properties = await Property.find({ brokerEmail: user.email });
            for (const prop of properties) {
                if (prop.images && prop.images.length > 0) {
                    for (const imgUrl of prop.images) {
                        try {
                            const publicId = imgUrl.split('/').slice(-2).join('/').split('.')[0];
                            await cloudinary.uploader.destroy(publicId);
                        } catch(e) { console.log("Cloudinary delete error", e); }
                    }
                }
            }
            await Property.deleteMany({ brokerEmail: user.email });
            await User.findByIdAndDelete(req.params.id);
            res.json({ success: true, message: 'User, their properties, and all photos deleted!' });
        } else { res.status(404).json({ success: false, message: 'User not found' }); }
    } catch (error) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is LIVE on port ${PORT}`));