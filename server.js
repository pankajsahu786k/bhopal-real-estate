require('dotenv').config(); // 🔴 SECURITY: गुप्त फाइल (.env) को पढ़ने के लिए

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const crypto = require('crypto'); 
const helmet = require('helmet'); // 🔴 SECURITY: हैकर अटैक्स रोकने के लिए
const rateLimit = require('express-rate-limit'); // 🔴 SECURITY: स्पैम रोकने के लिए

const app = express();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// पेमेंट्स का रिकॉर्ड रखने के लिए (Database से पहले वाली टेम्पररी मेमोरी)
const activePayments = {};
const pendingForms = {};

// 🔴 सिक्योरिटी चाबी (इसे अपनी .env फाइल में भी डाल सकते हैं)
const JWT_SECRET = process.env.JWT_SECRET || 'bhopal_super_secret_key_786';

// ==========================================
// 🛡️ SECURITY MIDDLEWARES
// ==========================================
app.use(helmet({ 
    contentSecurityPolicy: false, 
    crossOriginResourcePolicy: false 
}));
app.use(cors()); // इसे अभी ओपन रखा है ताकि आपकी साइट न टूटे
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// 🔴 SECURITY: 15 मिनट में 200 से ज्यादा रिक्वेस्ट आने पर ब्लॉक (एंटी-स्पैम)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 200, 
    message: { success: false, message: "Too many requests, please try again later." }
});
app.use('/api/', apiLimiter);

// ==========================================
// ☁️ CLOUDINARY SETUP (Keys Hidden)
// ==========================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const imageStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'bhopal_properties',
        allowedFormats: ['jpg', 'png', 'jpeg', 'webp']
    }
});
const upload = multer({ storage: imageStorage });
const pdfUpload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 1️⃣ MONGODB DATABASE CONNECTION (Keys Hidden)
// ==========================================
const mongoURI = process.env.MONGODB_URI;
mongoose.connect(mongoURI, { family: 4 })
    .then(() => console.log('✅ MongoDB Database Connected Successfully (Secured)!'))
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
    views: { type: Number, default: 0 }, clicks: { type: Number, default: 0 },
    transactionId: { type: String, default: 'FREE_BYPASS' },
    amountPaid: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'Free' },
    latitude: { type: Number },  // 🌟 NAYA: Property GPS Lat
    longitude: { type: Number }  // 🌟 NAYA: Property GPS Lng
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);

const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String, 
    photo: String, 
    dealingAreas: [String],
    latitude: { type: Number },   // 🌟 NAYA: GPS Latitude
    longitude: { type: Number }   // 🌟 NAYA: GPS Longitude
}, { timestamps: true });
const BrokerProfile = mongoose.model('BrokerProfile', brokerProfileSchema);

const verificationSchema = new mongoose.Schema({
    userEmail: String,      
    documentUrl: { type: String, default: '' },    
    tenantName: String,
    tenantFatherName: String,  
    tenantDOB: String,         
    tenantPhone: String,
    aadharNumber: String,
    tenantPermanentAddress: String, 
    permanentPoliceStation: String, 
    propertyAddress: String,
    currentPoliceStation: String,   
    ownerName: String,
    ownerPhone: String,
    tenantPhoto: String,    
    aadharFrontPhoto: { type: String, default: '' },
    aadharBackPhoto: { type: String, default: '' },
    familyMembers: Number,  
    status: { type: String, default: 'Pending' }, 
    transactionId: { type: String, default: '' }
}, { timestamps: true });
const Verification = mongoose.model('Verification', verificationSchema);

const rentAgreementSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    ownerName: String,
    ownerMobile: String,
    ownerAddress: String,
    tenantName: String,
    propAddress: String,
    monthlyRent: Number,
    securityDeposit: Number,
    durationMonths: Number,
    electricityRate: Number,
    startDate: String,
    status: { type: String, default: 'Complete' }
}, { timestamps: true });
const RentAgreement = mongoose.model('RentAgreement', rentAgreementSchema);

const serviceAnalyticsSchema = new mongoose.Schema({
    serviceName: { type: String, unique: true },
    clicks: { type: Number, default: 0 }
});
const ServiceAnalytics = mongoose.model('ServiceAnalytics', serviceAnalyticsSchema);

const configSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: Boolean
});
const Config = mongoose.model('Config', configSchema);

const universalReceiptSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    serviceName: { type: String, required: true }, 
    transactionId: { type: String, required: true },
    amountPaid: { type: Number, required: true },
    paymentStatus: { type: String, default: 'Paid' }
}, { timestamps: true });
const UniversalReceipt = mongoose.model('UniversalReceipt', universalReceiptSchema);

// =========================================================================
// 🏠 NEW FRESH TENANT LEDGER SCHEMA (🔥 RESET COLLECTION TO FIX ERRORS)
// =========================================================================
const TenantLedgerSchema = new mongoose.Schema({
    ownerEmail: { type: String, required: true },
    roomOrFlatNo: { type: String, required: true },
    
    tenantName: String,
    tenantFatherName: String,
    mobileNo: String,
    joiningDate: String, 
    unitRate: Number,      
    familyMembers: Number,
    aadharNumber: String, 
    jobStatus: String, 
    tenantEmail: String, 
    
    // 🔥 NEW FIELD SUCCESSFULLY ADDED IN SCHEMA
    currentMeterReading: { type: Number, default: 0 }, 

    monthlyEntries: [{
        monthDate: String,
        rent: Number,
        electricityUnit: Number,
        billAmount: Number,
        waterBill: Number,
        total: Number,
        isLocked: { type: Boolean, default: false }
    }],
    status: { type: String, enum: ['Active', 'Left'], default: 'Active' }
}, { 
    timestamps: true,
    collection: 'bhopal_active_tenants_v3' 
});

const TenantLedger = mongoose.models.TenantLedger || mongoose.model('TenantLedger', TenantLedgerSchema);

// 🚀 MASTER API ROUTE: UPSERT ENGINE
app.post('/api/owner/upsert-tenant-ledger', async (req, res) => {
    try {
        const { ownerEmail, roomOrFlatNo, monthlyEntries, ...tenantDetails } = req.body;
        
        await TenantLedger.updateOne(
            { ownerEmail, roomOrFlatNo, status: 'Active' },
            { 
                $set: { 
                    ...tenantDetails, 
                    monthlyEntries: monthlyEntries 
                } 
            },
            { upsert: true }
        );
        res.json({ success: true, message: "✅ डेटा सफलतापूर्ण सेव हो गया!" });
    } catch (error) {
        console.error("Database Save Error:", error);
        res.status(500).json({ success: false, message: 'Server Side Processing Interrupted.' });
    }
});
// 🌟 पेमेंट स्टेटस सेव करने के लिए 
const paymentStatus = {}; 

// 1. SMS RECEIVER BOT (Webhook)
// 1. NOTIFICATION RECEIVER BOT (Webhook - Updated for Fractional Amount)
app.post('/api/webhook', async (req, res) => {
    try {
        const smsText = req.body.smsText || ""; 
        console.log(`📱 PhonePe Notification Aaya: ${smsText}`);

        // यह Regex मैसेज में से पैसे (जैसे 149.45) निकालेगा
        const match = smsText.match(/(?:Rs|INR)?\s*(\d+\.\d{2})/i);

        if (match) {
            const receivedAmount = match[1]; // ये "149.45" देगा
            
            // चेक करेंगे कि क्या यह अमाउंट हमारी मेमोरी में पेंडिंग है
            if(activePayments[receivedAmount] && activePayments[receivedAmount].status === "pending") {
                
                // पेमेंट सक्सेसफुल! 
                activePayments[receivedAmount].status = 'Success'; 
                
                console.log(`✅ SUCCESS! Payment Confirmed for Amount ₹${receivedAmount} 🚀`);
                
                // 💡 (भविष्य के लिए: यहाँ आप अपनी Property या UniversalReceipt DB में भी इसे सेव कर सकते हैं)
            } else {
                console.log(`⚠️ ₹${receivedAmount} रिसीव हुआ, पर सर्वर पर कोई यूज़र पेंडिंग नहीं था।`);
            }
        }
        res.status(200).send("Webhook Processed Successfully");
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send("Error");
    }
});

// 2. CHECK PAYMENT STATUS (Polling API)
// 2. CHECK PAYMENT STATUS (Updated for Fractional Amount)
app.get('/api/check-payment-status', (req, res) => {
    const checkAmount = req.query.amount; // फ्रंटएंड से अमाउंट आएगा (जैसे 500.45)
    
    // हम अपनी 5-मिनट वाली मेमोरी में चेक करेंगे कि इस अमाउंट का स्टेटस क्या है
    if (activePayments[checkAmount]) {
        res.json({ status: activePayments[checkAmount].status }); // Pending या Success भेजेगा
    } else {
        res.json({ status: 'Not Found' }); 
    }
});
// ==========================================
// 3️⃣ OTHER API ROUTES (Old Functions Preserved)
// ==========================================
app.post('/api/save-rent-agreement', async (req, res) => {
    try {
        const { userEmail, agreementData } = req.body;
        const newAgreement = new RentAgreement({ userEmail: userEmail.toLowerCase().trim(), ...agreementData });
        await newAgreement.save();
        res.json({ success: true, message: '✅ Rent Agreement safely archived!' });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/user/my-verifications', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ success: false, message: "Email parameter missing" });
        const data = await Verification.find({ userEmail: email.toLowerCase().trim() }).sort({ createdAt: -1 });
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/save-receipt', async (req, res) => {
    try {
        const { userEmail, serviceName, transactionId, amountPaid, paymentStatus } = req.body;
        const newReceipt = new UniversalReceipt({
            userEmail: userEmail.toLowerCase().trim(),
            serviceName, transactionId, amountPaid,
            paymentStatus: paymentStatus || 'Paid'
        });
        await newReceipt.save();
        res.json({ success: true, message: "Receipt generated automatically!" });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/my-receipts', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ success: false, message: "Email required" });
        const receipts = await UniversalReceipt.find({ userEmail: email.toLowerCase().trim() }).sort({ createdAt: -1 });
        res.json({ success: true, receipts });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/track-service/:serviceName', async (req, res) => {
    try {
        const serviceName = req.params.serviceName;
        await ServiceAnalytics.findOneAndUpdate({ serviceName: serviceName }, { $inc: { clicks: 1 } }, { new: true, upsert: true });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.get('/api/admin/service-analytics', async (req, res) => {
    try {
        const analytics = await ServiceAnalytics.find({}).sort({ clicks: -1 });
        res.json({ success: true, data: analytics });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.get('/api/payment-status', async (req, res) => {
    try {
        const bypassConfig = await Config.findOne({ key: 'bypassPayment' });
        res.json({ success: true, isPaymentBypassed: bypassConfig ? bypassConfig.value : false });
    } catch (e) { res.status(500).json({ success: false, isPaymentBypassed: false }); }
});

app.post('/api/admin/toggle-payment', async (req, res) => {
    try {
        const { bypass } = req.body;
        await Config.findOneAndUpdate({ key: 'bypassPayment' }, { value: bypass }, { new: true, upsert: true });
        res.json({ success: true, message: bypass ? "Payment BYPASSED (Free Mode Active) 🔓" : "Payment ENABLED (Paid Mode Active) 💳" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/submit-verification', upload.fields([
    { name: 'tenantPhoto', maxCount: 1 }, { name: 'aadharFront', maxCount: 1 }, { name: 'aadharBack', maxCount: 1 }
]), async (req, res) => {
    try {
        const tenantPhotoUrl = req.files && req.files['tenantPhoto'] ? req.files['tenantPhoto'][0].path : 'https://placehold.co/150x150?text=No+Photo';
        const aadharFrontUrl = req.files && req.files['aadharFront'] ? req.files['aadharFront'][0].path : '';
        const aadharBackUrl = req.files && req.files['aadharBack'] ? req.files['aadharBack'][0].path : '';

        const draftId = 'DRAFT_' + Math.floor(Math.random() * 1000000);

        pendingForms[draftId] = { 
            ...req.body,
            // 🌟 FIX 1: ईमेल हर हाल में सेव होगा
            userEmail: req.body.userEmail ? req.body.userEmail.toLowerCase().trim() : 'guest@bhopal.com',
            tenantPhoto: tenantPhotoUrl, 
            aadharFrontPhoto: aadharFrontUrl, 
            aadharBackPhoto: aadharBackUrl, 
            status: 'Pending' // 🌟 FIX 2: इसे Pending किया ताकि एजेंट को दिखे
        };

        setTimeout(() => { delete pendingForms[draftId]; }, 15 * 60 * 1000);

        res.json({ success: true, draftId: draftId });
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

app.delete('/api/user/delete-property/:id', async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
        if (property.images && property.images.length > 0) {
            for (const imgUrl of property.images) {
                try {
                    const publicId = imgUrl.split('/').slice(-2).join('/').split('.')[0];
                    await cloudinary.uploader.destroy(publicId);
                } catch(e) { console.log("Cloudinary image delete error:", e); }
            }
        }
        await Property.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Property permanently deleted!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Server Error' }); }
});

app.get('/api/admin/verifications', async (req, res) => {
    try {
        const requests = await Verification.find({ status: 'Pending' }).sort({ createdAt: -1 }); 
        res.json({ success: true, requests });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/upload-verification-doc/:id', pdfUpload.single('verificationDoc'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                { folder: 'bhopal_properties_docs', resource_type: 'auto', format: 'pdf', public_id: `Verification_${req.params.id}_${Date.now()}` },
                (error, result) => { if (error) return reject(error); resolve(result); }
            );
            uploadStream.end(req.file.buffer);
        });
        const docUrl = uploadResult.secure_url || uploadResult.url;
        await Verification.findByIdAndUpdate(req.params.id, { status: 'Complete', documentUrl: docUrl });
        res.json({ success: true, message: '✅ PDF Uploaded and Status marked as Complete!' });
    } catch (error) { console.error("Cloudinary Upload Error:", error); res.status(500).json({ success: false, message: 'Server Error' }); }
});

app.post('/api/admin/change-verification-status/:id', async (req, res) => {
    try {
        await Verification.findByIdAndUpdate(req.params.id, { status: req.body.newStatus });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

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
app.post('/api/update-property/:id', upload.array('propertyImages', 3), async (req, res) => {
    try {
        const updateData = { ...req.body };
        if (req.files && req.files.length > 0) updateData.images = req.files.map(f => f.path || f.url);
        await Property.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true, message: 'Updated Successfully' });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/rk-upload-image', upload.single('rkImage'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadedUrl = req.file.path || req.file.url;
        return res.json({ success: true, url: uploadedUrl });
    } catch (error) { console.error("Cloudinary upload error:", error); return res.status(500).json({ success: false, message: 'Server Error' }); }
});

app.post('/api/rk-add-package', async (req, res) => {
    try {
        const { category, packageData } = req.body;
        packageData.status = 'published'; 
        await mongoose.connection.db.collection(`${category}_cards`).insertOne(packageData);
        res.json({ success: true, message: 'Package uploaded successfully to local db!' });
    } catch (error) { console.error("DB Save Error:", error); res.status(500).json({ success: false, message: 'Database Save Failed' }); }
});

app.get('/api/rk-get-packages/:category', async (req, res) => {
    try {
        const { category } = req.params;
        const items = await mongoose.connection.db.collection(`${category}_cards`).find({}).sort({ id: -1 }).toArray();
        res.json({ success: true, data: items });
    } catch (error) { res.status(500).json({ success: false, message: 'Fetch Failed' }); }
});

app.put('/api/rk-edit-package', async (req, res) => {
    try {
        const { category, id, updateData } = req.body;
        const { ObjectId } = require('mongodb');
        await mongoose.connection.db.collection(`${category}_cards`).updateOne({ _id: new ObjectId(id) }, { $set: updateData });
        res.json({ success: true, message: 'Package updated successfully!' });
    } catch (error) { console.error("DB Update Error:", error); res.status(500).json({ success: false, message: 'Edit Process Failed' }); }
});

app.post('/api/rk-toggle-status', async (req, res) => {
    try {
        const { category, id, status } = req.body;
        const { ObjectId } = require('mongodb');
        await mongoose.connection.db.collection(`${category}_cards`).updateOne({ _id: new ObjectId(id) }, { $set: { status: status } });
        res.json({ success: true, message: 'Status switched successfully!' });
    } catch (error) { console.error("Status Toggle Error:", error); res.status(500).json({ success: false }); }
});

app.delete('/api/rk-delete-package/:category/:id', async (req, res) => {
    try {
        const { category, id } = req.params;
        const { ObjectId } = require('mongodb');
        await mongoose.connection.db.collection(`${category}_cards`).deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: 'Package deleted successfully from local db!' });
    } catch (error) { console.error("DB Delete Error:", error); res.status(500).json({ success: false, message: 'Delete Operation Failed' }); }
});

// 🌍 Duri nikalne ka formula (Haversine Formula)
function getDistanceInKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

app.get('/api/get-properties', async(req, res) => {
    try {
        const brokerEmail = req.query.email;
        const userLat = parseFloat(req.query.lat); // Customer ka Lat
        const userLng = parseFloat(req.query.lng); // Customer ka Lng

        let properties = (brokerEmail && brokerEmail !== "undefined") 
            ? await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() }).lean()
            : await Property.find({ status: 'approved' }).lean();

        // 🌟 Agar customer ne apni location bheji hai, toh distance nikalo
        if (userLat && userLng) {
            properties = properties.map(prop => {
                let distance = null;
                // Pehle check karo property me GPS hai ya nahi
                if (prop.latitude && prop.longitude) {
                    distance = getDistanceInKm(userLat, userLng, prop.latitude, prop.longitude);
                }
                return { ...prop, distance: distance };
            });

            // Jinki distance null nahi hai, unhe paas se door ke hisaab se sort karo
            properties.sort((a, b) => {
                if (a.distance === null) return 1;
                if (b.distance === null) return -1;
                return a.distance - b.distance;
            });
        }

        res.json(properties);
    } catch (error) { 
        console.error(error);
        res.status(500).json({ message: 'Error' }); 
    }
});

app.get('/api/get-profile', async(req, res) => {
    try {
        const email = req.query.email;
        let profile = await BrokerProfile.findOne({ brokerEmail: email.toLowerCase().trim() });
        res.json(profile || { brokerEmail: email, phone: '', photo: '', dealingAreas: [] });
    } catch (error) { res.status(500).json({ message: 'Error' }); }
});
app.post('/api/update-profile', upload.single('profilePhoto'), async (req, res) => {
    try {
        const { brokerEmail, phone, latitude, longitude } = req.body;
        let areas = [];
        if (req.body.dealingAreas) {
            try { areas = JSON.parse(req.body.dealingAreas); } catch (e) { areas = Array.isArray(req.body.dealingAreas) ? req.body.dealingAreas : req.body.dealingAreas.split(','); }
        }
        const updateData = { phone: phone, dealingAreas: areas };
        
        // 🌟 NAYA: अगर GPS डेटा आया है तो उसे भी सेव करें
        if (latitude) updateData.latitude = Number(latitude);
        if (longitude) updateData.longitude = Number(longitude);
        
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

        // 🔴 पासवर्ड को Bcrypt से एन्क्रिप्ट (Hash) करें
        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        
        await PendingUser.deleteMany({ email: emailLower });
        // प्लेन पासवर्ड की जगह hashedPassword सेव करें
        const newPendingUser = new PendingUser({ name, email: emailLower, password: hashedPassword, otp });
        await newPendingUser.save();
        
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

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const emailLower = email.toLowerCase().trim();

        const user = await User.findOne({ email: emailLower });
        if (user) {
            // 🔴 एन्क्रिप्टेड पासवर्ड को मैच करें (पुराने प्लेन पासवर्ड्स के लिए भी फॉलबैक है)
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch && password !== user.password) {
                return res.status(401).json({ success: false, message: 'गलत पासवर्ड!' });
            }

            let actualRole = user.role || 'user';
            if (user.email === "devilking786k@sahu.com") actualRole = 'admin';

            // 🔴 यूज़र के लिए एक सुरक्षित JWT टोकन (ID Card) बनाएँ
            const token = jwt.sign({ userId: user._id, role: actualRole, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

            return res.json({ success: true, name: user.name, email: user.email, role: actualRole, token: token });
        }

        // किरायेदार का लॉगिन
        const tenant = await TenantLedger.findOne({ tenantEmail: emailLower, tenantPassword: password });
        if (tenant) {
            const token = jwt.sign({ tenantId: tenant._id, role: 'tenant', email: tenant.tenantEmail }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ success: true, name: tenant.tenantName, email: tenant.tenantEmail, role: 'tenant', token: token, tenantData: tenant });
        }

        return res.status(401).json({ success: false, message: 'गलत ईमेल या पासवर्ड!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Server Error' }); }
});

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
    } catch (error) { res.status(500).json({ success: false, message: 'Server Error' }); }
});
// 🌟 डायनामिक अमाउंट जनरेटर API
app.post('/api/create-payment', (req, res) => {
    const userId = req.body.userId; 
    
    // 🌟 पेंच फिक्स: अब बेस अमाउंट फ्रंटएंड से आएगा। अगर नहीं आया, तो डिफ़ॉल्ट 149 मान लेगा।
    const baseAmount = req.body.baseAmount ? parseFloat(req.body.baseAmount) : 149;

    // इंजन चलाकर यूनिक अमाउंट निकाला (उदा: 500 आया तो 499.01 से 501.99 के बीच निकालेगा)
    const finalAmount = getUniquePaymentAmount(baseAmount, userId);

    if (!finalAmount) {
        return res.status(500).json({ success: false, message: "सर्वर अभी बिजी है, 1 मिनट बाद कोशिश करें।" });
    }

    res.json({ success: true, amount: finalAmount });
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

app.get('/api/owner/my-tenants', async (req, res) => {
    try {
        const { email } = req.query;
        const tenants = await TenantLedger.find({ ownerEmail: email });
        res.json({ success: true, data: tenants });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/tenant/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const tenant = await TenantLedger.findOne({ tenantEmail: email, tenantPassword: password });

        if (!tenant) {
            return res.status(401).json({ success: false, message: 'गलत ईमेल या पासवर्ड! कृपया दोबारा जांचें।' });
        }

        res.json({ 
            success: true, 
            message: 'लॉगิน सफल!',
            role: 'tenant',
            tenantData: tenant
        });
    } catch (error) {
        res.status(500).json({ success: 
            false, message: 'Server Error' });
    }
});
// ==========================================
// 🌟 ADMIN PAYMENTS FETCH API (NEW)
// ==========================================
app.get('/api/admin/get-payments', async (req, res) => {
    try {
        const queryDate = req.query.date; 
        // यूनिवर्सल रसीद वाले डेटाबेस से सक्सेस पेमेंट्स निकालेंगे
        let filter = { paymentStatus: { $in: ['Paid', 'Success'] } }; 

        // अगर एडमिन ने कैलेंडर से डेट सेलेक्ट की है
        if (queryDate) {
            const startDate = new Date(queryDate);
            startDate.setHours(0, 0, 0, 0);
            
            const endDate = new Date(queryDate);
            endDate.setHours(23, 59, 59, 999);

            filter.createdAt = { $gte: startDate, $lte: endDate };
        }

        // UniversalReceipt कलेक्शन से डेटा निकालें
        const paymentsData = await UniversalReceipt.find(filter).sort({ createdAt: -1 }); 
        
        res.json({
            success: true,
            payments: paymentsData
        });

    } catch (error) {
        console.error("Payment Fetch API Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});
// 🌟 1. प्रॉपर्टी को ड्राफ्ट (RAM) में सेव करने वाला API
app.post('/api/submit-property-draft', upload.array('propertyImages', 3), async (req, res) => {
    try {
        const imageUrls = req.files ? req.files.map(f => f.path || f.url) : [];
        const draftId = 'DRAFT_PROP_' + Math.floor(Math.random() * 1000000);

        // डेटा को हवा (RAM) में रोक लिया
        pendingForms[draftId] = {
            ...req.body,
            images: imageUrls,
            brokerEmail: req.body.brokerEmail ? req.body.brokerEmail.toLowerCase().trim() : 'unknown',
            status: 'pending' // पब्लिश होने के लिए पेंडिंग 
        };

        // 15 मिनट बाद ऑटो-डिलीट (Garbage Collection)
        setTimeout(() => { delete pendingForms[draftId]; }, 15 * 60 * 1000);

        res.json({ success: true, draftId: draftId });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error creating property draft' });
    }
});

app.get('/api/tenant/my-ledger', async (req, res) => {
    try {
        const { email } = req.query;
        const ledger = await TenantLedger.findOne({ tenantEmail: email });
        if (!ledger) return res.status(404).json({ success: false, message: 'कोई रिकॉर्ड नहीं मिला।' });
        res.json({ success: true, data: ledger });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});
// 🌟 यह API सिर्फ तब चलेगा जब पेमेंट सक्सेसफुल हो जाएगा
// 🌟 2. अपडेटेड Finalize Record API
app.post('/api/finalize-record', async (req, res) => {
    try {
        const { draftId, transactionId, amountPaid, userEmail } = req.body;
        
        if (pendingForms[draftId]) {
            const finalData = pendingForms[draftId];
            finalData.transactionId = transactionId;
            finalData.amountPaid = amountPaid;
            
            // 🌟 FIX 3: अगर पहले से ईमेल नहीं था, तो पेमेंट पेज वाला ईमेल डाल दो
            if (!finalData.userEmail && userEmail) {
                finalData.userEmail = userEmail;
            }
            
            if (finalData.serviceType === 'Property') {
                const newProperty = new Property(finalData);
                await newProperty.save();
            } else {
                const newRequest = new Verification(finalData);
                await newRequest.save();
            }
            
            delete pendingForms[draftId]; 
            res.json({ success: true, message: "डेटाबेस में परमानेंट सेव हो गया!" });
        } else {
            res.status(400).json({ success: false, message: "टाइम आउट हो गया या फॉर्म डेटा नहीं मिला।" });
        }
    } catch (error) {
        console.error("Finalization Error:", error);
        res.status(500).json({ success: false, message: "Error saving final record" });
    }
});
function getUniquePaymentAmount(baseAmount, userId) {
    // रेंज: 148.01 से 150.99 (लगभग 300 यूनिक अमाउंट)
    const min = (baseAmount - 1) * 100 + 1; // 14801 (पैसे में)
    const max = (baseAmount + 1) * 100 + 99; // 15099 (पैसे में)
    
    let attempts = 0;
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000; // 5 मिनट को मिलीसेकंड में बदला

    // हम 500 बार ट्राई करेंगे कोई खाली अमाउंट ढूँढने की
    while (attempts < 500) {
        let randomInt = Math.floor(Math.random() * (max - min + 1)) + min;
        let amount = (randomInt / 100).toFixed(2); // इसे वापस रुपये में बदला, जैसे "149.45"

        // चेक 1: क्या यह अमाउंट पहले से किसी को दिया हुआ है?
        if (activePayments[amount]) {
            // चेक 2: अगर दिया है, तो क्या उसके 5 मिनट पूरे (Expire) हो गए हैं?
            if (now > activePayments[amount].expiresAt) {
                // हाँ, एक्सपायर हो गया! हम इसे पुराने यूज़र से छीन कर नए यूज़र को दे देंगे
                activePayments[amount] = { 
                    userId: userId, 
                    expiresAt: now + FIVE_MINUTES, 
                    status: "pending" 
                };
                return amount;
            }
            // अगर 5 मिनट नहीं हुए, तो लूप वापस घूमेगा और नया अमाउंट ट्राई करेगा
        } else {
            // यह अमाउंट एकदम फ्रेश और फ्री है!
            activePayments[amount] = { 
                userId: userId, 
                expiresAt: now + FIVE_MINUTES, 
                status: "pending" 
            };
            return amount;
        }
        attempts++;
    }
    return null; // अगर एक साथ 300 लोग आ गए और सब फुल हो गया (जो बहुत मुश्किल है)
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is LIVE on port ${PORT} (Secured 🔒)`));