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
const cron = require('node-cron'); // ⏰ Smart Brain 3-Slot Scheduler

const app = express();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// पेमेंट्स का रिकॉर्ड रखने के लिए (Database से पहले वाली टेम्पररी मेमोरी)
const activePayments = {};
const pendingForms = {};

// 🔴 सिक्योरिटी चाबी
const JWT_SECRET = process.env.JWT_SECRET || 'bhopal_super_secret_key_786';
const { connectToWhatsApp, sendDirectWhatsApp } = require('./whatsappService');
const { connectToWhatsApp, sendDirectWhatsApp, getLatestQr } = require('./whatsappService');

// ==========================================
// 🛡️ SECURITY MIDDLEWARES
// ==========================================
app.use(helmet({ 
    contentSecurityPolicy: false, 
    crossOriginResourcePolicy: false 
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 200, 
    message: { success: false, message: "Too many requests, please try again later." }
});
app.use('/api/', apiLimiter);

// ==========================================
// ☁️ CLOUDINARY SETUP
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
// 1️⃣ MONGODB DATABASE CONNECTION
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
    latitude: { type: Number },
    longitude: { type: Number }
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);

const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String, 
    photo: String, 
    dealingAreas: [String],
    latitude: { type: Number },
    longitude: { type: Number }
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
// 🏠 TENANT LEDGER SCHEMA (SMART BOT ENGINE COMPATIBLE)
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
    
    currentMeterReading: { type: Number, default: 0 }, 

    // 🌟 SMART BRAIN TRACKING FIELDS
    lastAlertSentAt: { type: Date, default: null },       
    alertCount: { type: Number, default: 0 },             
    needsAssistance: { type: Boolean, default: false },   

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

// =========================================================================
// 🚀 MASTER API ROUTE: UPSERT ENGINE
// =========================================================================
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

// =========================================================================
// 🧠 SMART BRAIN ENGINE: 9 AM | 12 PM | 8 PM BOT SYSTEM
// =========================================================================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendAutomationWhatsApp(phone, message) {
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        const MACRODROID_DEVICE_ID = process.env.MACRODROID_DEVICE_ID || "YOUR_DEVICE_ID_HERE"; 
        const webhookUrl = `https://trigger.macrodroid.com/${MACRODROID_DEVICE_ID}/send_ledger_alert?phone=${cleanPhone}&msg=${encodeURIComponent(message)}`;

        await fetch(webhookUrl);
        console.log(`📡 Signal sent to MacroDroid for ${cleanPhone}`);
    } catch (err) {
        console.error("MacroDroid Webhook Error:", err.message);
    }
}

async function processLedgerReminders(slotType) {
    try {
        const today = new Date();
        const currentDay = today.getDate();
        const currentMonthStr = today.toLocaleDateString('hi-IN', { month: 'short', year: 'numeric' });

        const activeTenants = await TenantLedger.find({ status: 'Active' });

        for (const tenant of activeTenants) {
            if (!tenant.joiningDate) continue;

            const joinDate = new Date(tenant.joiningDate);
            const isBillingDay = (joinDate.getDate() === currentDay);

            if (!isBillingDay) continue;

            const isUpdated = tenant.monthlyEntries && tenant.monthlyEntries.some(entry => 
                entry.monthDate && entry.monthDate.includes(currentMonthStr) && (entry.total > 0 || entry.rent > 0)
            );

            // Agar ledger update nahi hua hai:
            if (!isUpdated) {
                const owner = await BrokerProfile.findOne({ brokerEmail: tenant.ownerEmail });
                const phone = owner ? owner.phone : tenant.mobileNo;

                if (!phone) continue;

                let messageText = "";

                // 🌅 9:00 AM Vision Integration
                if (slotType === 'morning_9am') {
                    messageText = `Good morning sir, aaj aapke tenant (${tenant.roomOrFlatNo} - ${tenant.tenantName}) ka month complete ho gaya hai. Kripya apna ledger update karein taaki monthly rent time to time aapke account me aa sake. 🙏\nBhopal Properties`;
                    tenant.alertCount = 1;
                } 
                // ☀️ 12:00 PM Vision Integration
                else if (slotType === 'afternoon_12pm') {
                    messageText = `Good afternoon sir, aapne abhi tak apna ledger update nahi kiya hai (${tenant.roomOrFlatNo} - ${tenant.tenantName}). Sir please apna ledger update karein taaki apna hisab clear rahe. 📊\nBhopal Properties`;
                    tenant.alertCount = 2;
                } 
                // 🌙 8:00 PM Vision Integration (Support & Agent Offer)
                else if (slotType === 'evening_8pm') {
                    messageText = `Good evening sir, aapko ledger update karne me agar koi problem aa rahi hai toh hum aapko customer support provide kar sakte hain, ya kal hum apne agent ko bhej kar ledger update karwa dein? 🤝\nBhopal Properties Support`;
                    tenant.alertCount = 3;
                    tenant.needsAssistance = true;

                    // Support employee ko alert send karna
                    const employeeMobile = "919993352339"; 
                    const empAlert = `🚨 CUSTOMER SUPPORT ACTION:\nOwner (${tenant.ownerEmail}) ne ${tenant.roomOrFlatNo} (${tenant.tenantName}) ka ledger update nahi kiya hai. Kal subah call ya agent bhej kar update karwayen.`;
                    await sendDirectWhatsApp(employeeMobile, empAlert);
                    await sleep(3000);
                }

                tenant.lastAlertSentAt = new Date();
                await tenant.save();

                await sendDirectWhatsApp(phone, messageText);
                await sleep(3000); // 3 second safe delay for bulk tenants
            } 
            // Agar owner ne update kar diya hai:
            else if (isUpdated && tenant.alertCount > 0) {
                tenant.alertCount = 0;
                tenant.lastAlertSentAt = null;
                tenant.needsAssistance = false;
                await tenant.save();
            }
        }
    } catch (err) {
        console.error("Smart Brain Error:", err);
    }
}

// ⏰ 1. SUBAH 9:00 AM (09:00 IST)
cron.schedule('0 9 * * *', () => {
    console.log("🌅 Running 9:00 AM Morning Check...");
    processLedgerReminders('morning_9am');
}, { timezone: "Asia/Kolkata" });

// ⏰ 2. DOPAHER 12:00 PM (12:00 IST)
cron.schedule('0 12 * * *', () => {
    console.log("☀️ Running 12:00 PM Afternoon Check...");
    processLedgerReminders('afternoon_12pm');
}, { timezone: "Asia/Kolkata" });

// ⏰ 3. SHAAM 8:00 PM (20:00 IST)
cron.schedule('0 20 * * *', () => {
    console.log("🌙 Running 8:00 PM Evening Check...");
    processLedgerReminders('evening_8pm');
}, { timezone: "Asia/Kolkata" });

// =========================================================================
// 🛠️ EMPLOYEE SUPPORT DASHBOARD API
// =========================================================================
app.get('/api/admin/pending-assistances', async (req, res) => {
    try {
        const stuckTenants = await TenantLedger.find({ 
            status: 'Active', 
            needsAssistance: true 
        });
        res.json({ success: true, count: stuckTenants.length, data: stuckTenants });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// 📊 PUBLIC READ-ONLY PASSBOOK API
app.get('/api/public/tenant-ledger/:id', async (req, res) => {
    try {
        const tenantRecord = await TenantLedger.findById(req.params.id);
        if (!tenantRecord) {
            return res.status(404).json({ success: false, message: "रिकॉर्ड नहीं मिला!" });
        }

        res.json({
            success: true,
            data: {
                roomOrFlatNo: tenantRecord.roomOrFlatNo,
                tenantName: tenantRecord.tenantName,
                mobileNo: tenantRecord.mobileNo,
                joiningDate: tenantRecord.joiningDate,
                unitRate: tenantRecord.unitRate,
                monthlyEntries: tenantRecord.monthlyEntries || []
            }
        });
    } catch (err) {
        console.error("Public Ledger API Error:", err);
        res.status(500).json({ success: false, message: "सर्वर एरर" });
    }
});
app.get('/qr', (req, res) => {
    const qrData = getLatestQr();
    if (!qrData) {
        return res.send('<h2>WhatsApp pehle se connected hai ya QR load ho raha hai. Page refresh karein.</h2>');
    }
    res.send(`
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
            <h2>Scan WhatsApp QR Code</h2>
            <img src="${qrData}" alt="WhatsApp QR" style="width:300px;height:300px;border:1px solid #ccc;padding:10px;border-radius:8px;" />
            <p>WhatsApp -> Linked Devices -> Link a Device</p>
        </div>
    `);
});

// ==========================================
// 3️⃣ OTHER API ROUTES
// ==========================================
app.post('/api/webhook', async (req, res) => {
    try {
        const smsText = req.body.smsText || ""; 
        console.log(`📱 PhonePe Notification Aaya: ${smsText}`);

        const match = smsText.match(/(?:Rs|INR)?\s*(\d+\.\d{2})/i);

        if (match) {
            const receivedAmount = match[1];
            if(activePayments[receivedAmount] && activePayments[receivedAmount].status === "pending") {
                activePayments[receivedAmount].status = 'Success'; 
                console.log(`✅ SUCCESS! Payment Confirmed for Amount ₹${receivedAmount} 🚀`);
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

app.get('/api/check-payment-status', (req, res) => {
    const checkAmount = req.query.amount;
    if (activePayments[checkAmount]) {
        res.json({ status: activePayments[checkAmount].status });
    } else {
        res.json({ status: 'Not Found' }); 
    }
});

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
            userEmail: req.body.userEmail ? req.body.userEmail.toLowerCase().trim() : 'guest@bhopal.com',
            tenantPhoto: tenantPhotoUrl, 
            aadharFrontPhoto: aadharFrontUrl, 
            aadharBackPhoto: aadharBackUrl, 
            status: 'Pending'
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
        const userLat = parseFloat(req.query.lat);
        const userLng = parseFloat(req.query.lng);

        let properties = (brokerEmail && brokerEmail !== "undefined") 
            ? await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() }).lean()
            : await Property.find({ status: 'approved' }).lean();

        if (userLat && userLng) {
            properties = properties.map(prop => {
                let distance = null;
                if (prop.latitude && prop.longitude) {
                    distance = getDistanceInKm(userLat, userLng, prop.latitude, prop.longitude);
                }
                return { ...prop, distance: distance };
            });

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

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        
        await PendingUser.deleteMany({ email: emailLower });
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
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch && password !== user.password) {
                return res.status(401).json({ success: false, message: 'गलत पासवर्ड!' });
            }

            let actualRole = user.role || 'user';
            if (user.email === "devilking786k@sahu.com") actualRole = 'admin';

            const token = jwt.sign({ userId: user._id, role: actualRole, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

            return res.json({ success: true, name: user.name, email: user.email, role: actualRole, token: token });
        }

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
    try {
        const property = await Property.findByIdAndUpdate(
            req.params.id, 
            { status: 'approved' }, 
            { new: true }
        );

        if (property) {
            try {
                let imagesList = Array.isArray(property.images) ? [...property.images] : [];

                if (imagesList.length === 0) {
                    imagesList = [
                        "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1080",
                        "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1080"
                    ];
                } else if (imagesList.length === 1) {
                    imagesList.push(imagesList[0]);
                }

                await fetch('https://hook.eu1.make.com/74j6gk5c2ywmtp3pzx4nyr5bavfgfkyq', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: property._id.toString(),
                        title: property.title || "Property in Bhopal",
                        purpose: property.purpose || "Sale/Rent",
                        price: property.purpose === 'Rent' ? `₹${property.price}/month` : `₹${property.price}`,
                        location: property.location || "Bhopal",
                        images: imagesList,
                        propertyUrl: `https://bhopal-real-estate.onrender.com/property/${property._id}`,
                        brokerEmail: property.brokerEmail || "info@bhopal.com"
                    })
                });
                console.log(`🚀 Property ${property._id} approved & sent to Make.com Carousel!`);
            } catch (webhookErr) {
                console.error("Make.com webhook trigger error:", webhookErr.message);
            }
        }

        res.json({ success: true, message: "Property approved & queued for Instagram post!" });
    } catch (error) {
        console.error("Approval error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
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
        res.json({ success: true, message: 'Property permanently deleted!' });
    } catch (error) { res.status(500).json({ success: false, message: 'Server Error' }); }
});

app.post('/api/create-payment', (req, res) => {
    const userId = req.body.userId; 
    const baseAmount = req.body.baseAmount ? parseFloat(req.body.baseAmount) : 149;
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
            message: 'लॉगिन सफल!',
            role: 'tenant',
            tenantData: tenant
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.get('/api/admin/get-payments', async (req, res) => {
    try {
        const queryDate = req.query.date; 
        let filter = { paymentStatus: { $in: ['Paid', 'Success'] } }; 

        if (queryDate) {
            const startDate = new Date(queryDate);
            startDate.setHours(0, 0, 0, 0);
            
            const endDate = new Date(queryDate);
            endDate.setHours(23, 59, 59, 999);

            filter.createdAt = { $gte: startDate,$lte: endDate };
        }

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

app.post('/api/submit-property-draft', upload.array('propertyImages', 3), async (req, res) => {
    try {
        const imageUrls = req.files ? req.files.map(f => f.path || f.url) : [];
        const draftId = 'DRAFT_PROP_' + Math.floor(Math.random() * 1000000);

        pendingForms[draftId] = {
            ...req.body,
            images: imageUrls,
            brokerEmail: req.body.brokerEmail ? req.body.brokerEmail.toLowerCase().trim() : 'unknown',
            status: 'pending'
        };

        setTimeout(() => { delete pendingForms[draftId]; }, 15 * 60 * 1000);

        res.json({ success: true, draftId: draftId });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error creating property draft' });
    }
});

// 🧪 MANUAL TEST TRIGGER ROUTE
app.get('/api/test-reminders', async (req, res) => {
    const slot = req.query.slot || 'morning_9am';
    console.log(`Manual trigger initiated for slot: ${slot}`);
    await processLedgerReminders(slot);
    res.json({ success: true, message: `Processed reminders for ${slot}` });
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

app.post('/api/finalize-record', async (req, res) => {
    try {
        const { draftId, transactionId, amountPaid, userEmail } = req.body;
        
        if (pendingForms[draftId]) {
            const finalData = pendingForms[draftId];
            finalData.transactionId = transactionId;
            finalData.amountPaid = amountPaid;
            
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
    const min = (baseAmount - 1) * 100 + 1;
    const max = (baseAmount + 1) * 100 + 99;
    
    let attempts = 0;
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;

    while (attempts < 500) {
        let randomInt = Math.floor(Math.random() * (max - min + 1)) + min;
        let amount = (randomInt / 100).toFixed(2);

        if (activePayments[amount]) {
            if (now > activePayments[amount].expiresAt) {
                activePayments[amount] = { 
                    userId: userId, 
                    expiresAt: now + FIVE_MINUTES, 
                    status: "pending" 
                };
                return amount;
            }
        } else {
            activePayments[amount] = { 
                userId: userId, 
                expiresAt: now + FIVE_MINUTES, 
                status: "pending" 
            };
            return amount;
        }
        attempts++;
    }
    return null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is LIVE on port ${PORT} (Secured 🔒)`);
    connectToWhatsApp();
});