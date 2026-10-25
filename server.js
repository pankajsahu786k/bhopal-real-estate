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
const customPaymentDB = {}; // 🚀 NEW: For 24-hr Async Payment Links

// 🔴 सिक्योरिटी चाबी
const JWT_SECRET = process.env.JWT_SECRET || 'bhopal_super_secret_key_786';
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
    name: String, 
    email: { type: String, unique: true, required: true }, 
    phone: { type: String, default: '' }, // 📱 Verified WhatsApp Number
    password: { type: String, required: true }, 
    role: { type: String, default: 'user' }
});
const User = mongoose.model('User', userSchema);

const pendingUserSchema = new mongoose.Schema({
    name: String, 
    email: { type: String, required: true }, 
    phone: { type: String, default: '' }, // 📱 WhatsApp OTP bhejne ke liye
    password: String, 
    otp: String,
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

// 🌟 BROKER PROFILE SCHEMA (With DOB, Completion Guard & Welcome Sent Flag)
const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String, 
    photo: String, 
    dealingAreas: [String],
    dob: { type: String, default: '' }, // 🎂 Broker DOB (YYYY-MM-DD)
    latitude: { type: Number },
    longitude: { type: Number },
    isProfileComplete: { type: Boolean, default: false },
    welcomeSent: { type: Boolean, default: false }
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
// 🏠 TENANT LEDGER SCHEMA (WITH PAID AMOUNT, BALANCE & WHATSAPP FLAGS)
// =========================================================================
const TenantLedgerSchema = new mongoose.Schema({
    ownerEmail: { type: String, required: true },
    roomOrFlatNo: { type: String, required: true },
    
    tenantName: String,
    tenantFatherName: String,
    tenantDOB: { type: String, default: '' }, // 🎂 Birthday Wishes Integration
    mobileNo: String,
    joiningDate: String, 
    unitRate: Number,      
    familyMembers: Number,
    aadharNumber: String, 
    jobStatus: String, 
    tenantEmail: String, 
    
    currentMeterReading: { type: Number, default: 0 }, 

    // 🚀 NEW: Payment Link Tracking Fields
    activeOrderId: { type: String, default: null },
    activePaymentLink: { type: String, default: null },
    linkExpiryTime: { type: Date, default: null },

    // 🌟 SMART BRAIN TRACKING FIELDS
    lastAlertSentAt: { type: Date, default: null },       
    alertCount: { type: Number, default: 0 },             
    needsAssistance: { type: Boolean, default: false },   

    monthlyEntries: [{
        monthDate: String,
        rent: Number,
        electricityUnit: Number,
        billAmount: Number,
        waterUnit: { type: Number, default: 0 },
        waterBill: Number,
        total: Number,
        paidAmount: { type: Number, default: 0 }, // 💵 Kitna paisa jama hua
        balance: { type: Number, default: 0 },    // ⚖️ Kitna baki raha (Carry Forward)
        billNotified: { type: Boolean, default: false }, // 📤 Bill WhatsApp gaya ya nahi
        paidNotified: { type: Boolean, default: false }, // ✅ Receipt WhatsApp gayi ya nahi
        isLocked: { type: Boolean, default: false }
    }],
    status: { type: String, enum: ['Active', 'Left'], default: 'Active' }
}, { 
    timestamps: true,
    collection: 'bhopal_active_tenants_v3' 
});

const TenantLedger = mongoose.models.TenantLedger || mongoose.model('TenantLedger', TenantLedgerSchema);

// =========================================================================
// 💳 CORE ENGINE: SMART ASYNC LINK GENERATOR
// =========================================================================
async function getOrGeneratePaymentLink(tenant) {
    const currentTime = new Date();
    const latestEntry = (tenant.monthlyEntries || []).filter(e => Number(e.total) > 0).pop();
    const dueAmount = latestEntry ? (Number(latestEntry.balance !== undefined ? latestEntry.balance : latestEntry.total) || 0) : 0;

    // 1. Agar link valid hai (24 hours expire nahi hui) -> Return old link
    if (tenant.activePaymentLink && tenant.linkExpiryTime && new Date(tenant.linkExpiryTime) > currentTime) {
        if (!customPaymentDB[tenant.activeOrderId]) {
            customPaymentDB[tenant.activeOrderId] = {
                orderId: tenant.activeOrderId,
                tenantId: tenant._id,
                amount: dueAmount,
                status: 'PENDING',
                validUpto: tenant.linkExpiryTime
            };
        } else {
            customPaymentDB[tenant.activeOrderId].amount = dueAmount;
        }
        return tenant.activePaymentLink; 
    }

    // 2. Agar expire ho gayi hai -> Generate NEW 24-hr link
    const newOrderId = 'BRE-INV-' + Date.now().toString().slice(-8);
    const newExpiry = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000);
    const newLink = `https://bhopal-real-estate.onrender.com/pay/${newOrderId}`;

    tenant.activeOrderId = newOrderId;
    tenant.activePaymentLink = newLink;
    tenant.linkExpiryTime = newExpiry;
    await tenant.save();

    customPaymentDB[newOrderId] = {
        orderId: newOrderId,
        tenantId: tenant._id,
        amount: dueAmount,
        status: 'PENDING',
        validUpto: newExpiry
    };

    return newLink;
}

// =========================================================================
// 🛡️ MIDDLEWARE: BROKER PROFILE COMPLETION GUARD
// =========================================================================
async function requireCompleteProfile(req, res, next) {
    try {
        const bodyObj = req.body || {};
        const queryObj = req.query || {};

        let email = (
            bodyObj.brokerEmail || bodyObj.userEmail || bodyObj.email || queryObj.email || queryObj.brokerEmail || ''
        ).toLowerCase().trim();

        if (email === 'null' || email === 'undefined') email = '';

        if (!email && req.headers.authorization) {
            try {
                const token = req.headers.authorization.replace('Bearer ', '').trim();
                const decoded = jwt.verify(token, JWT_SECRET);
                if (decoded && decoded.email) {
                    email = decoded.email.toLowerCase().trim();
                }
            } catch (e) {}
        }

        if (!email && bodyObj.contactNumber) {
            const cleanPhone = bodyObj.contactNumber.toString().replace(/\D/g, '').slice(-10);
            if (cleanPhone.length === 10) {
                const profByPhone = await BrokerProfile.findOne({ phone: { $regex: cleanPhone } });
                if (profByPhone && profByPhone.brokerEmail) {
                    email = profByPhone.brokerEmail.toLowerCase().trim();
                } else {
                    const userByPhone = await User.findOne({ phone: { $regex: cleanPhone } });
                    if (userByPhone && userByPhone.email) {
                        email = userByPhone.email.toLowerCase().trim();
                    }
                }
            }
        }

        if (!email) {
            return res.status(401).json({ success: false, message: "Aapka Login session expire ho gaya hai! Kripya ek baar Logout karke dobara Login karein." });
        }

        req.body.brokerEmail = email;

        const brokerProfile = await BrokerProfile.findOne({ brokerEmail: { $regex: new RegExp(`^${email}$`, 'i') } });

        if (!brokerProfile || !brokerProfile.isProfileComplete) {
            return res.status(403).json({ success: false, requireProfileCompletion: true, message: "Aapko pehle apni Profile poori complete karni hogi (Photo, Phone, DOB, Dealing Areas)!" });
        }
        next();
    } catch (err) {
        console.error("Profile Guard Error:", err);
        res.status(500).json({ success: false, message: "Security Check Failed" });
    }
}

// =========================================================================
// 🚀 MASTER API ROUTE: UPSERT ENGINE + AUTOMATIC WHATSAPP BILL & RECEIPT
// =========================================================================
app.post('/api/owner/upsert-tenant-ledger', async (req, res) => {
    try {
        const { ownerEmail, roomOrFlatNo, monthlyEntries, ...tenantDetails } = req.body;
        
        if (tenantDetails.status === 'Left') {
            await TenantLedger.updateOne(
                { ownerEmail, roomOrFlatNo, status: 'Active' },
                { $set: { status: 'Left' } }
            );
            return res.json({ success: true, message: "🚪 रूम खाली कर दिया गया और हिस्ट्री में सेव हो गया!" });
        }

        const existingRecord = await TenantLedger.findOne({ ownerEmail, roomOrFlatNo, status: 'Active' });

        // Preserve notification flags from old entries before saving
        if (Array.isArray(monthlyEntries) && existingRecord && Array.isArray(existingRecord.monthlyEntries)) {
            for (let i = 0; i < monthlyEntries.length; i++) {
                const oldEntry = existingRecord.monthlyEntries[i];
                if (oldEntry) {
                    // Agar total ya paidAmount badla nahi hai toh purane flags rakhein
                    if (Number(oldEntry.total) === Number(monthlyEntries[i].total)) {
                        monthlyEntries[i].billNotified = oldEntry.billNotified || false;
                    }
                    if (Number(oldEntry.paidAmount) === Number(monthlyEntries[i].paidAmount)) {
                        monthlyEntries[i].paidNotified = oldEntry.paidNotified || false;
                    }
                }
            }
        }

        // 1. Update Database First
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

        // 2. Fetch the saved record to process notifications and dynamic links
        const savedTenant = await TenantLedger.findOne({ ownerEmail, roomOrFlatNo, status: 'Active' });

        if (savedTenant && savedTenant.monthlyEntries && savedTenant.monthlyEntries.length > 0) {
            for (let i = 0; i < savedTenant.monthlyEntries.length; i++) {
                const entry = savedTenant.monthlyEntries[i];
                const passbookUrl = `https://bhopal-real-estate.onrender.com/passbook.html?id=${savedTenant._id}`;

                // 📲 1. AUTOMATIC BILL WHATSAPP WITH PAYMENT LINK
                if (Number(entry.total) > 0 && !entry.billNotified && savedTenant.mobileNo) {
                    const paymentLink = await getOrGeneratePaymentLink(savedTenant); // Magic Link
                    const prevBal = i > 0 ? (Number(savedTenant.monthlyEntries[i - 1].balance) || 0) : 0;
                    
                    const billMsg = `📊 *मासिक किराया एवं बिल हिसाब (Bhopal Properties)*\n\nनमस्ते *${savedTenant.tenantName}* जी (रूम/फ्लैट: *${roomOrFlatNo}*),\nआपका *${entry.monthDate}* का लेजर बिल अपडेट हो गया है:\n\n🏠 मासिक किराया: ₹${entry.rent || 0}\n⚡ बिजली बिल: ₹${entry.billAmount || 0} (Reading: ${entry.electricityUnit || 0})\n💧 पानी बिल: ₹${entry.waterBill || 0}\n🔄 पिछला बकाया: ₹${prevBal}\n----------------------\n💰 *कुल देय राशि (Total): ₹${entry.total}*\n💵 जमा राशि (Paid): ₹${entry.paidAmount || 0}\n⚖️ *शेष बकाया (Balance): ₹${entry.balance || 0}*\n\n🔗 *ऑनलाइन भुगतान करें (24 घंटे मान्य):*\n${paymentLink}\n\nकृपया समय पर पेमेंट कर अपना डिजिटल खाता क्लियर रखें। 🙏\n🌐 Passbook: ${passbookUrl}`;

                    sendDirectWhatsApp(savedTenant.mobileNo, billMsg).catch(e => console.error(e));
                    savedTenant.monthlyEntries[i].billNotified = true;
                }

                // 📲 2. AUTOMATIC PAYMENT RECEIPT WHATSAPP (Jab Owner manual entry kare)
                const newPaid = Number(entry.paidAmount) || 0;
                if (newPaid > 0 && !entry.paidNotified && savedTenant.mobileNo) {
                    const receiptMsg = `✅ *पेमेंट प्राप्त रसीद (Payment Received)*\n\nनमस्ते *${savedTenant.tenantName}* जी (${roomOrFlatNo}),\n*${entry.monthDate}* के कुल बिल (₹${entry.total}) में से आपकी *₹${newPaid}* की राशि प्राप्त हो गई है।\n\n⚖️ *शेष बकाया (Balance): ₹${entry.balance || 0}*\n(यदि कोई शेष राशि है, तो वह अगले माह के बिल में जुड़कर आएगी)\n\nधन्यवाद! 🙏\n🌐 Passbook: ${passbookUrl}`;

                    sendDirectWhatsApp(savedTenant.mobileNo, receiptMsg).catch(e => console.error(e));
                    savedTenant.monthlyEntries[i].paidNotified = true;
                }
            }
            savedTenant.markModified('monthlyEntries');
            await savedTenant.save(); // Save notification flags and links
        }
        res.json({ success: true, message: "✅ डेटा सफलतापूर्वक सेव हो गया और WhatsApp पर पेमेंट लिंक भेज दिया गया!" });
    } catch (error) {
        console.error("Database Save Error:", error);
        res.status(500).json({ success: false, message: 'Server Side Processing Interrupted.' });
    }
});

// =========================================================================
// 🧠 SMART BRAIN ENGINE: 9 AM | 12 PM | 8 PM BOT SYSTEM (OWNER + TENANT)
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
            const activeEntries = (tenant.monthlyEntries || []).filter(e => Number(e.total) > 0);
            const latestEntry = activeEntries.length > 0 ? activeEntries[activeEntries.length - 1] : null;

            // =================================================================
            // 1️⃣ OWNER REMINDER: Billing date par agar Owner ne ledger update nahi kiya
            // =================================================================
            if (tenant.joiningDate) {
                const joinDate = new Date(tenant.joiningDate);
                const isBillingDay = (joinDate.getDate() === currentDay);

                const isUpdated = tenant.monthlyEntries && tenant.monthlyEntries.some(entry => 
                    entry.monthDate && entry.monthDate.includes(currentMonthStr) && (entry.total > 0 || entry.rent > 0)
                );

                if (isBillingDay && !isUpdated) {
                    const owner = await BrokerProfile.findOne({ brokerEmail: tenant.ownerEmail });
                    const ownerPhone = owner ? owner.phone : null;

                    if (ownerPhone) {
                        let messageText = "";

                        if (slotType === 'morning_9am') {
                            messageText = `Good morning sir, aaj aapke tenant (${tenant.roomOrFlatNo} - ${tenant.tenantName}) ka month complete ho gaya hai. Kripya apna ledger update karein taaki monthly rent time to time aapke account me aa sake. 🙏\n\n🔗 Update Ledger: https://bhopal-real-estate.onrender.com\nBhopal Properties`;
                            tenant.alertCount = 1;
                        } 
                        else if (slotType === 'afternoon_12pm') {
                            messageText = `Good afternoon sir, aapne abhi tak apna ledger update nahi kiya hai (${tenant.roomOrFlatNo} - ${tenant.tenantName}). Sir please apna ledger update karein taaki apna hisab clear rahe. 📊\n\n🔗 Update Ledger: https://bhopal-real-estate.onrender.com\nBhopal Properties`;
                            tenant.alertCount = 2;
                        } 
                        else if (slotType === 'evening_8pm') {
                            messageText = `Good evening sir, aapko ledger update karne me agar koi problem aa rahi hai toh hum aapko customer support provide kar sakte hain, ya kal hum apne agent ko bhej kar ledger update karwa dein? 🤝\n\n🌐 Support: https://bhopal-real-estate.onrender.com\nBhopal Properties Support`;
                            tenant.alertCount = 3;
                            tenant.needsAssistance = true;

                            const employeeMobile = "919993352339"; 
                            const empAlert = `🚨 CUSTOMER SUPPORT ACTION:\nOwner (${tenant.ownerEmail}) ne ${tenant.roomOrFlatNo} (${tenant.tenantName}) ka ledger update nahi kiya hai. Kal subah call ya agent bhej kar update karwayen.`;
                            await sendDirectWhatsApp(employeeMobile, empAlert);
                            await sleep(3000);
                        }

                        tenant.lastAlertSentAt = new Date();
                        await tenant.save();

                        await sendDirectWhatsApp(ownerPhone, messageText);
                        await sleep(3000);
                    }
                } else if (isUpdated && tenant.alertCount > 0) {
                    tenant.alertCount = 0;
                    tenant.lastAlertSentAt = null;
                    tenant.needsAssistance = false;
                    await tenant.save();
                }
            }

            // =================================================================
            // 2️⃣ TENANT PAYMENT CHASER WITH SMART LINK (9 AM, 12 PM, 8 PM)
            // =================================================================
            if (latestEntry && Number(latestEntry.total) > 0 && Number(latestEntry.paidAmount || 0) === 0 && tenant.mobileNo) {
                
                const paymentLink = await getOrGeneratePaymentLink(tenant); 
                let tenantReminderMsg = "";
                const passbookUrl = `https://bhopal-real-estate.onrender.com/passbook.html?id=${tenant._id}`;

                if (slotType === 'morning_9am') {
                    tenantReminderMsg = `🌅 सुप्रभात *${tenant.tenantName}* जी (${tenant.roomOrFlatNo}),\nआपका *${latestEntry.monthDate}* का कुल किराया एवं बिल *₹${latestEntry.total}* पेंडिंग है। कृपया आज भुगतान करें। 🙏\n\n🔗 *ऑनलाइन पेमेंट लिंक (24 घंटे मान्य):*\n${paymentLink}\n\n🌐 Passbook: ${passbookUrl}\n- Bhopal Properties`;
                } 
                else if (slotType === 'afternoon_12pm') {
                    tenantReminderMsg = `☀️ नमस्ते *${tenant.tenantName}* जी (${tenant.roomOrFlatNo}),\nरिमाइंडर: आपके बिल की राशि *₹${latestEntry.total}* पेंडिंग है। यदि भुगतान नहीं किया है तो नीचे दी गई लिंक से अभी पे करें:\n\n🔗 ${paymentLink}\n\n🌐 Passbook: ${passbookUrl}`;
                } 
                else if (slotType === 'evening_8pm') {
                    tenantReminderMsg = `🌙 शुभ संध्या *${tenant.tenantName}* जी (${tenant.roomOrFlatNo}),\nआपका इस माह का *₹${latestEntry.total}* का भुगतान अभी तक लेजर में दर्ज नहीं हुआ है। अपना खाता क्लियर रखने के लिए अभी पे करें: 🤝\n\n🔗 ${paymentLink}\n\n🌐 Passbook: ${passbookUrl}\n- Bhopal Properties`;
                }

                if (tenantReminderMsg) {
                    await sendDirectWhatsApp(tenant.mobileNo, tenantReminderMsg);
                    console.log(`📤 Tenant Rent Reminder (${slotType}) sent to: ${tenant.tenantName} (${tenant.mobileNo})`);
                    await sleep(3000);
                }
            }
        }
    } catch (err) {
        console.error("Smart Brain Error:", err);
    }
}

// =========================================================================
// 💳 CUSTOM HOSTED PAYMENT PAGE, LIVE POLLING & DUAL WHATSAPP RECEIPTS
// =========================================================================

// Common Function: Ledger ko Paid mark karne aur Tenant + Owner dono ko WhatsApp Receipt bhejne ke liye
async function markTenantLedgerPaid(tenantId, paidAmt, txnRef) {
    const tenant = await TenantLedger.findById(tenantId);
    if (!tenant || !tenant.monthlyEntries) return false;

    let updated = false;
    let paidEntryDetails = null;
    let finalAddedAmt = 0;

    for (let i = tenant.monthlyEntries.length - 1; i >= 0; i--) {
        const entry = tenant.monthlyEntries[i];
        const currentBalance = Number(entry.balance !== undefined ? entry.balance : entry.total) || 0;

        // Latest unpaid entry dhoondhein
        if (Number(entry.total) > 0 && currentBalance > 0) {
            finalAddedAmt = Number(paidAmt) || currentBalance;
            entry.paidAmount = (Number(entry.paidAmount) || 0) + finalAddedAmt;
            entry.balance = Math.max(0, Number(entry.total) - entry.paidAmount);
            entry.paidNotified = true;

            tenant.alertCount = 0;
            tenant.needsAssistance = false;
            tenant.lastAlertSentAt = null;
            updated = true;
            paidEntryDetails = entry;
            break;
        }
    }

    if (updated && paidEntryDetails) {
        tenant.markModified('monthlyEntries');
        await tenant.save();

        const dateStr = new Date().toLocaleDateString('hi-IN', { 
            day: '2-digit', month: 'short', year: 'numeric', 
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Kolkata'
        });
        const passbookUrl = `https://bhopal-real-estate.onrender.com/passbook.html?id=${tenant._id}`;

        // 💾 1. UniversalReceipt me bhi save karein taaki Admin / Owner ke record me rahe
        try {
            await new UniversalReceipt({
                userEmail: tenant.ownerEmail,
                serviceName: `Rent Ledger - ${tenant.roomOrFlatNo} (${tenant.tenantName})`,
                transactionId: txnRef,
                amountPaid: finalAddedAmt,
                paymentStatus: 'Paid'
            }).save();
        } catch (e) { console.error("UniversalReceipt Save Error:", e); }

        // 📲 2. TENANT (किरायेदार) KO WHATSAPP RECEIPT BHEJEIN
        if (tenant.mobileNo) {
            const tenantReceiptMsg = `✅ *ऑटोमैटिक पेमेंट रसीद (Bhopal Properties)*\n\nनमस्ते *${tenant.tenantName}* जी (${tenant.roomOrFlatNo}),\nआपके मासिक बिल (*${paidEntryDetails.monthDate}*) में से *₹${finalAddedAmt}* का ऑनलाइन भुगतान सफलतापूर्वक प्राप्त हो गया है! 🎉\n\n━━━━━━━━━━━━━━━━━━\n🏠 *रूम/फ्लैट:* ${tenant.roomOrFlatNo}\n💰 *कुल बिल:* ₹${paidEntryDetails.total}\n💵 *जमा राशि (Paid):* ₹${paidEntryDetails.paidAmount}\n⚖️ *शेष बकाया (Balance):* ₹${paidEntryDetails.balance}\n🔢 *UTR / Ref:* ${txnRef}\n📅 *दिनांक:* ${dateStr}\n━━━━━━━━━━━━━━━━━━\n\nआपका डिजिटल खाता अपडेट कर दिया गया है।\n🌐 *Live Passbook:* ${passbookUrl}\n\nधन्यवाद! 🙏`;

            sendDirectWhatsApp(tenant.mobileNo, tenantReceiptMsg).catch(e => console.error("Tenant WA Receipt Err:", e));
        }

        // 📲 3. OWNER (मकान मालिक) KO BHI WHATSAPP RECEIPT AUR CONFIRMATION BHEJEIN
        try {
            let ownerPhone = '';
            let ownerName = 'Owner';

            const brokerDoc = await BrokerProfile.findOne({ brokerEmail: { $regex: new RegExp(`^${tenant.ownerEmail}$`, 'i') } });
            const userDoc = await User.findOne({ email: { $regex: new RegExp(`^${tenant.ownerEmail}$`, 'i') } });

            if (userDoc && userDoc.name) ownerName = userDoc.name;
            if (brokerDoc && brokerDoc.phone) ownerPhone = brokerDoc.phone;
            else if (userDoc && userDoc.phone) ownerPhone = userDoc.phone;

            if (ownerPhone) {
                const ownerReceiptMsg = `🔔 *किराया प्राप्त सूचना एवं रसीद (Owner Copy)*\n\nनमस्ते *${ownerName}* जी,\nआपके किरायेदार *${tenant.tenantName}* (*${tenant.roomOrFlatNo}*) ने ऑनलाइन पेमेंट लिंक के माध्यम से *₹${finalAddedAmt}* का भुगतान कर दिया है! 💰✅\n\n━━━━━━━━━━━━━━━━━━\n👤 *किरायेदार:* ${tenant.tenantName} (${tenant.mobileNo || 'N/A'})\n🏠 *रूम नं:* ${tenant.roomOrFlatNo}\n📅 *माह:* ${paidEntryDetails.monthDate}\n💰 *कुल बिल:* ₹${paidEntryDetails.total}\n💵 *प्राप्त राशि (Paid):* ₹${paidEntryDetails.paidAmount}\n⚖️ *शेष बकाया (Balance):* ₹${paidEntryDetails.balance}\n🔢 *UTR / Ref:* ${txnRef}\n━━━━━━━━━━━━━━━━━━\n\n✨ आपके *Tangent Digital Khata* में यह एंट्री अपने आप अपडेट (Balance: ₹${paidEntryDetails.balance}) कर दी गई है।\n\n🌐 *Check Ledger:* https://bhopal-real-estate.onrender.com/owner-ledger.html`;

                setTimeout(() => {
                    sendDirectWhatsApp(ownerPhone, ownerReceiptMsg).catch(e => console.error("Owner WA Receipt Err:", e));
                }, 2000);
            }
        } catch (ownerErr) {
            console.error("Owner Notification Error:", ownerErr);
        }
    }
    return updated;
}

// 1. Render Smart Payment Page (With Auto-Detect Polling & Receipt View)
app.get('/pay/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    let order = customPaymentDB[orderId];

    // Agar server restart hua ho toh MongoDB se order recover karein
    if (!order) {
        const tenant = await TenantLedger.findOne({ activeOrderId: orderId, status: 'Active' });
        if (tenant) {
            const latestEntry = (tenant.monthlyEntries || []).filter(e => Number(e.total) > 0).pop();
            const dueAmt = latestEntry ? (Number(latestEntry.balance) || Number(latestEntry.total) || 0) : 0;
            order = {
                orderId: orderId,
                tenantId: tenant._id,
                tenantName: tenant.tenantName,
                roomNo: tenant.roomOrFlatNo,
                amount: dueAmt,
                status: (latestEntry && Number(latestEntry.balance) === 0 && Number(latestEntry.paidAmount) > 0) ? 'PAID' : 'PENDING',
                validUpto: tenant.linkExpiryTime || new Date(Date.now() + 86400000),
                transactionRef: 'ONLINE_UPI'
            };
            customPaymentDB[orderId] = order;
        }
    }

    if (!order) {
        return res.status(404).send("<h2 style='text-align:center; padding:50px; font-family:sans-serif;'>❌ Invalid Payment Link</h2>");
    }

    // ✅ AGAR PAYMENT HO CHUKA HAI TOH SEEDHA PAKKI RECEIPT DIKHAYEIN
    if (order.status === 'PAID') {
        return res.send(`
        <!DOCTYPE html><html lang="hi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Receipt - ${order.orderId}</title>
        <style>body{font-family:sans-serif;background:#f0fdf4;display:flex;justify-content:center;align-items:center;min-height:95vh;margin:0;padding:15px;} .rec-box{background:white;padding:25px;border-radius:14px;max-width:380px;width:100%;box-shadow:0 10px 25px rgba(0,0,0,0.08);border-top:6px solid #16a34a;text-align:center;} table{width:100%;text-align:left;border-collapse:collapse;margin:15px 0;font-size:14px;} td{padding:8px 0;border-bottom:1px dashed #cbd5e1;} .btn{display:inline-block;width:100%;padding:12px;background:#1e1b4b;color:white;text-decoration:none;border:none;border-radius:8px;font-weight:bold;cursor:pointer;margin-top:10px;}</style></head>
        <body>
            <div class="rec-box">
                <div style="font-size:48px;">🎉</div>
                <h2 style="color:#16a34a;margin:5px 0;">Payment Successful!</h2>
                <p style="font-size:12px;color:#64748b;margin:0;">Bhopal Properties Official Digital Receipt</p>
                <table>
                    <tr><td><b>Order ID:</b></td><td>${order.orderId}</td></tr>
                    <tr><td><b>Amount Paid:</b></td><td style="color:#16a34a;font-weight:bold;font-size:16px;">₹${order.amount}</td></tr>
                    <tr><td><b>UTR / Ref No:</b></td><td><b>${order.transactionRef || 'VERIFIED'}</b></td></tr>
                    <tr><td><b>Status:</b></td><td style="color:#16a34a;font-weight:bold;">✔ PAID & LEDGER UPDATED</td></tr>
                </table>
                <button onclick="window.print()" class="btn">🖨️ Download / Print Receipt</button>
            </div>
        </body></html>
        `);
    }

    if (new Date() > new Date(order.validUpto)) {
        return res.send("<h2 style='text-align:center; padding:50px; color:red; font-family:sans-serif;'>⏳ Link Expired! Nayi link agle reminder me aayegi.</h2>");
    }

    // 🔴 AAPKI ASLI UPI ID
    const yourUpiId = "bhopalrealestate@axl"; 
    const merchantName = "Yogita Sahu";

    const upiString = `upi://pay?pa=${yourUpiId}&pn=${encodeURIComponent(merchantName)}&tr=${order.orderId}&tid=${order.orderId}&am=${order.amount}&cu=INR`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=2&data=${encodeURIComponent(upiString)}`;

    res.send(`
    <!DOCTYPE html><html lang="hi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pay ₹${order.amount}</title>
    <style>
        body{font-family:sans-serif;background:#f1f5f9;display:flex;justify-content:center;padding:20px;margin:0;} 
        .card{background:white;padding:22px;border-radius:12px;text-align:center;width:100%;max-width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.08);border-top:5px solid #16a34a;} 
        .btn{display:block;width:100%;padding:14px;background:#16a34a;color:white;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:15px;font-size:15px;border:none;cursor:pointer;box-sizing:border-box;}
        .pulse{font-size:12px;color:#d97706;background:#fef3c7;padding:8px;border-radius:6px;margin-top:12px;font-weight:bold;}
    </style></head>
    <body>
        <div class="card">
            <h3 style="margin:0; color:#1e1b4b;">Bhopal Real Estate</h3>
            <p style="font-size:12px;color:#666; margin-top:4px;">Order ID: <b>${order.orderId}</b></p>
            <h1 style="color:#16a34a; font-size:36px; margin:12px 0;">₹${order.amount}</h1>
            
            <div style="background:#f8fafc; padding:10px; border-radius:8px; border:1.5px dashed #cbd5e1; display:inline-block;">
                <img src="${qrUrl}" alt="QR" style="width:180px;height:180px;display:block;">
                <p style="font-size:11px; color:#475569; margin:6px 0 0; font-weight:bold;">Scan with PhonePe / GPay / Paytm</p>
            </div>
            
            <a href="${upiString}" class="btn">📲 Pay ₹${order.amount} via PhonePe / GPay</a>

            <div class="pulse">⏳ Waiting for payment...<br><span style="font-size:11px;font-weight:normal;">Payment hote hi yeh page apne aap Receipt ban jayega, ya neeche UTR daal kar turant verify karein:</span></div>
            
            <form action="/api/custom-gateway/webhook" method="POST" style="margin-top:12px; border-top:1px solid #eee; padding-top:12px;">
                <input type="hidden" name="orderId" value="${order.orderId}">
                <input type="text" name="transactionRef" placeholder="Enter 12-Digit UTR No. (e.g. 919808...)" required style="width:100%;padding:11px;margin-bottom:10px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box;font-size:13px;text-align:center;">
                <button type="submit" class="btn" style="background:#1e1b4b; margin-top:0;">✔ Submit UTR & Get Instant Receipt</button>
            </form>
        </div>

        <script>
            // 🔄 Har 3 second me check karega ki MacroDroid webhook aaya ya nahi
            setInterval(async () => {
                try {
                    const res = await fetch('/api/custom-gateway/status/${order.orderId}');
                    const data = await res.json();
                    if (data.status === 'PAID') {
                        window.location.reload(); // Paid hote hi page reload hokar Receipt dikhayega!
                    }
                } catch(e) {}
            }, 3000);
        </script>
    </body></html>
    `);
});

// Status Polling API for Payment Page
app.get('/api/custom-gateway/status/:orderId', (req, res) => {
    const order = customPaymentDB[req.params.orderId];
    if (!order) return res.json({ status: 'NOT_FOUND' });
    res.json({ status: order.status });
});

// 2. Manual UTR Submit Webhook (Customer UTR daale toh bhi turant update ho)
app.post('/api/custom-gateway/webhook', async (req, res) => {
    const { orderId, transactionRef } = req.body;
    let order = customPaymentDB[orderId];

    if (!order) {
        const tenant = await TenantLedger.findOne({ activeOrderId: orderId, status: 'Active' });
        if (tenant) {
            const latestEntry = (tenant.monthlyEntries || []).filter(e => Number(e.total) > 0).pop();
            order = { orderId, tenantId: tenant._id, amount: latestEntry ? latestEntry.total : 0, status: 'PENDING' };
            customPaymentDB[orderId] = order;
        }
    }

    if (order && order.status !== 'PAID') {
        order.status = 'PAID';
        order.transactionRef = transactionRef || 'UTR-' + Date.now();
        await markTenantLedgerPaid(order.tenantId, order.amount, order.transactionRef);
        console.log(`✅ Manual UTR Verified & Ledger Updated for ${orderId}`);
    }

    // Redirect back to /pay/:orderId so customer immediately sees the Receipt Page!
    res.redirect(`/pay/${orderId}`);
});

// =========================================================================
// 🌐 100% FULLY AUTOMATED INTERNET FESTIVAL & BIRTHDAY ENGINE (TENANTS + BROKERS)
// =========================================================================
let festivalCache = {};

async function updateFestivalCalendar() {
    try {
        const currentYear = new Date().getFullYear();
        console.log(`📡 Fetching live festival calendar for year ${currentYear}...`);
        
        const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${currentYear}/IN`);
        const text = await response.text();
        
        if (!response.ok || !text) {
            console.log(`ℹ️ External API returned empty data, using built-in Indian calendar.`);
            return festivalCache;
        }
        
        const holidays = JSON.parse(text);
        const updated = {};

        holidays.forEach(holiday => {
            const parts = holiday.date.split('-');
            const day = parts[2].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const key = `${day}-${month}`;
            updated[key] = holiday.localName || holiday.name;
        });

        festivalCache = { ...festivalCache, ...updated };
        console.log(`✅ Internet se ${currentYear} ke ${holidays.length} festivals auto-load ho gaye!`);
        return festivalCache;
    } catch (err) {
        console.error('❌ Festival auto-fetch error:', err.message);
        return festivalCache;
    }
}

async function processGreetingsAndWishes(forcedFestivalName = null) {
    try {
        if (Object.keys(festivalCache).length === 0) {
            await updateFestivalCalendar();
        }

        const today = new Date();
        const currentDay = String(today.getDate()).padStart(2, '0');
        const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
        const todayKey = `${currentDay}-${currentMonth}`; // DD-MM format

        const activeTenants = await TenantLedger.find({ status: 'Active' });
        const allBrokers = await BrokerProfile.find({ phone: { $exists: true, $ne: '' } });

        const isBirthdayToday = (dobString) => {
            if (!dobString) return false;
            const clean = dobString.replace(/\//g, '-');
            const parts = clean.split('-');
            let d = '', m = '';
            if (parts[0].length === 4) { // YYYY-MM-DD
                m = parts[1].padStart(2, '0');
                d = parts[2].padStart(2, '0');
            } else { // DD-MM-YYYY
                d = parts[0].padStart(2, '0');
                m = parts[1].padStart(2, '0');
            }
            return (d === currentDay && m === currentMonth);
        };

        // 🎂 1 & 2. BIRTHDAY WISHES (Sirf tab chalega jab force festival test NA ho raha ho)
        if (!forcedFestivalName) {
            // Brokers Birthday
            for (const broker of allBrokers) {
                if (broker.dob && broker.phone && isBirthdayToday(broker.dob)) {
                    const brokerUser = await User.findOne({ email: broker.brokerEmail });
                    const brokerName = brokerUser ? brokerUser.name : 'Partner';

                    const brokerBdayMsg = `🎂 जन्मदिन की ढेरों शुभकामनाएँ, ${brokerName} ji! 🎉💐\n\nBhopal Properties की पूरी टीम की ओर से आपको जन्मदिन की हार्दिक बधाई। ईश्वर आपको व्यवसाय में नई ऊँचाइयाँ, उत्तम स्वास्थ्य और अपार सफलता प्रदान करें। 🌟🚀\n\n🌐 Portal: https://bhopal-real-estate.onrender.com\n- Bhopal Properties Business Network`;
                    await sendDirectWhatsApp(broker.phone, brokerBdayMsg);
                    console.log(`🎂 Birthday wish sent to Broker: ${brokerName} (${broker.phone})`);
                    await sleep(3000);
                }
            }

            // Tenants Birthday
            for (const tenant of activeTenants) {
                if (tenant.tenantDOB && tenant.mobileNo && isBirthdayToday(tenant.tenantDOB)) {
                    const bdayMsg = `🎂 जन्मदिन की हार्दिक शुभकामनाएँ, ${tenant.tenantName} ji! 🎉\n\nभोपाल प्रॉपर्टीज परिवार की तरफ से आपके उत्तम स्वास्थ्य, दीर्घायु और खुशियों भरे वर्ष की मंगलकामना करते हैं। Have a fantastic day ahead! 🌟\n\n🌐 Visit Us: https://bhopal-real-estate.onrender.com\n- Bhopal Properties`;
                    await sendDirectWhatsApp(tenant.mobileNo, bdayMsg);
                    console.log(`🎂 Birthday wish sent to Tenant: ${tenant.tenantName}`);
                    await sleep(3000);
                }
            }
        }

        // 🪔 3. FESTIVAL GREETINGS: BROKERS FIRST, THEN TENANTS
        const festivalName = forcedFestivalName || festivalCache[todayKey];

        if (festivalName) {
            console.log(`🎉 Tyohar Triggered: ${festivalName}. Broadcasting wishes...`);

            for (const broker of allBrokers) {
                if (broker.phone) {
                    const brokerUser = await User.findOne({ email: broker.brokerEmail });
                    const brokerName = brokerUser ? brokerUser.name : 'Partner';

                    const brokerFestMsg = `नमस्ते ${brokerName} ji! 🙏\n\nआपको और आपके परिवार को ${festivalName} के पावन अवसर पर Bhopal Properties की ओर से हार्दिक शुभकामनाएँ! 🪔✨\n\nयह त्योहार आपके व्यापार में नई खुशियाँ, तरक्की और नए अवसर लेकर आए। 💼📈\n\n🌐 Portal: https://bhopal-real-estate.onrender.com\n- Team Bhopal Properties`;
                    await sendDirectWhatsApp(broker.phone, brokerFestMsg);
                    console.log(`📤 Festival wish sent to Broker: ${brokerName}`);
                    await sleep(3000);
                }
            }

            const tenantFestMsg = `आपको और आपके पूरे परिवार को ${festivalName} की हार्दिक शुभकामनाएँ! 🪔✨\nजीवन में सुख, शांति और समृद्धि बनी रहे।\n\n🌐 Visit: https://bhopal-real-estate.onrender.com\n- Bhopal Properties`;
            for (const tenant of activeTenants) {
                if (tenant.mobileNo) {
                    await sendDirectWhatsApp(tenant.mobileNo, tenantFestMsg);
                    console.log(`📤 Festival wish sent to Tenant: ${tenant.tenantName}`);
                    await sleep(3000);
                }
            }
        } else {
            console.log(`ℹ️ Aaj (${todayKey}) koi festival scheduled nahi hai.`);
        }
    } catch (err) {
        console.error("Wishes Engine Error:", err);
    }
}

// ⏰ Roz Subah 8:00 AM Cron Job (Automated Daily Check)
cron.schedule('0 8 * * *', () => {
    console.log("🌅 Running 8:00 AM Birthday & Festival Check...");
    processGreetingsAndWishes();
}, { timezone: "Asia/Kolkata" });

// ⏰ Har Mahine ki 1 tareekh ko auto calendar sync
cron.schedule('0 0 1 * *', () => {
    console.log("🔄 Syncing holiday calendar from internet...");
    updateFestivalCalendar();
}, { timezone: "Asia/Kolkata" });

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

// 📱 QR CODE DISPLAY ROUTE (FOR EASY SCANNING)
app.get('/qr', (req, res) => {
    const qrData = getLatestQr();
    if (!qrData) {
        return res.send(`
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:Arial,sans-serif;text-align:center;">
                <h2 style="color:#25D366;">WhatsApp Connection Status</h2>
                <p>WhatsApp ya toh pehle se <b>Connected</b> hai, ya QR code generate ho raha hai.</p>
                <p>Agar scan nahi hua hai toh 5 second baad page refresh karein.</p>
                <button onclick="location.reload()" style="padding:10px 20px;font-size:16px;cursor:pointer;background:#25D366;color:#fff;border:none;border-radius:5px;">Refresh</button>
            </div>
        `);
    }

    res.send(`
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;font-family:Arial,sans-serif;text-align:center;">
            <h2>WhatsApp Web Scanner</h2>
            <p>WhatsApp open karein > <b>Linked Devices</b> > <b>Link a Device</b> se scan karein</p>
            <div style="padding:15px;background:#fff;border:2px solid #25D366;border-radius:12px;display:inline-block;box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                <img src="${qrData}" alt="WhatsApp QR Code" style="width:280px;height:280px;display:block;" />
            </div>
            <p style="color:#666;font-size:13px;margin-top:12px;">QR expire hone par page refresh karein.</p>
        </div>
    `);
});

// =========================================================================
// 🚀 GOOGLE SEO TEHALKA: AUTO-DYNAMIC SITEMAP & ROBOTS.TXT
// =========================================================================
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *\nAllow: /\nSitemap: https://bhopal-real-estate.onrender.com/sitemap.xml`);
});

app.get('/sitemap.xml', async (req, res) => {
    try {
        const baseUrl = 'https://bhopal-real-estate.onrender.com';
        const approvedProps = await Property.find({ status: 'approved' }).select('_id updatedAt').lean();

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

        const mainPages = [
            { url: '/', priority: '1.0' },
            { url: '/login.html', priority: '0.8' },
            { url: '/signup.html', priority: '0.8' }
        ];

        mainPages.forEach(page => {
            xml += `  <url>\n    <loc>${baseUrl}${page.url}</loc>\n    <changefreq>daily</changefreq>\n    <priority>${page.priority}</priority>\n  </url>\n`;
        });

        approvedProps.forEach(prop => {
            const lastMod = prop.updatedAt ? new Date(prop.updatedAt).toISOString() : new Date().toISOString();
            xml += `  <url>\n    <loc>${baseUrl}/?property=${prop._id}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
        });

        xml += `</urlset>`;
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (err) {
        console.error("Sitemap error:", err);
        res.status(500).end();
    }
});

// =========================================================================
// 📱 MACRODROID PHONEPE / BANK SMS WEBHOOK (SUPPORTS BOTH DECIMAL & LEDGER)
// =========================================================================
app.post('/api/webhook', async (req, res) => {
    try {
        const smsText = req.body.smsText || req.query.smsText || ""; 
        console.log(`📱 PhonePe/Bank Notification Aaya: ${smsText}`);

        // Match both whole numbers (₹11, Rs. 7860) and decimals (149.05)
        const amountMatch = smsText.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i) || smsText.match(/\b(\d+\.\d{2})\b/);
        // Extract 12-digit UTR if present in notification
        const utrMatch = smsText.match(/\b(\d{12})\b/);
        const extractedUtr = utrMatch ? utrMatch[1] : ('AUTO_' + Date.now().toString().slice(-6));

        if (amountMatch) {
            const rawAmount = amountMatch[1].replace(/,/g, '');
            const numericAmount = Number(rawAmount);

            // 1. Check in old decimal activePayments system (Services / Verification fee ke liye)
            if (activePayments[rawAmount] && activePayments[rawAmount].status === "pending") {
                activePayments[rawAmount].status = 'Success'; 
                console.log(`✅ Old System Payment Confirmed for ₹${rawAmount}`);
            }

            // 2. 🚀 NEW: Check in Custom Payment Links & Tenant Ledger!
            let matchedOrder = Object.values(customPaymentDB).find(
                o => o.status === 'PENDING' && Number(o.amount) === numericAmount
            );

            if (matchedOrder) {
                matchedOrder.status = 'PAID';
                matchedOrder.transactionRef = extractedUtr;
                await markTenantLedgerPaid(matchedOrder.tenantId, numericAmount, extractedUtr);
                console.log(`✅ MacroDroid Auto-Updated Ledger Order ${matchedOrder.orderId} for ₹${numericAmount}!`);
            } else {
                // Fallback: Agar server restart hua ho toh seedha MongoDB TenantLedger me dhoondhein
                const activeTenants = await TenantLedger.find({ status: 'Active' });
                for (const tenant of activeTenants) {
                    const latestEntry = (tenant.monthlyEntries || []).filter(e => Number(e.total) > 0).pop();
                    const dueBal = latestEntry ? (Number(latestEntry.balance !== undefined ? latestEntry.balance : latestEntry.total) || 0) : 0;

                    if (latestEntry && dueBal === numericAmount && Number(latestEntry.paidAmount || 0) === 0) {
                        await markTenantLedgerPaid(tenant._id, numericAmount, extractedUtr);
                        if (tenant.activeOrderId && customPaymentDB[tenant.activeOrderId]) {
                            customPaymentDB[tenant.activeOrderId].status = 'PAID';
                            customPaymentDB[tenant.activeOrderId].transactionRef = extractedUtr;
                        }
                        console.log(`✅ MongoDB Direct Match: Ledger Auto-Updated for ${tenant.tenantName} (₹${numericAmount})!`);
                        break;
                    }
                }
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

// =========================================================================
// 🧾 SAVE RECEIPT ON SERVER + SEND INSTANT WHATSAPP RECEIPT (2-IN-1)
// =========================================================================
app.post('/api/save-receipt', async (req, res) => {
    try {
        const { userEmail, serviceName, transactionId, amountPaid, paymentStatus, phone } = req.body;
        const cleanEmail = userEmail ? userEmail.toLowerCase().trim() : 'guest@bhopal.com';

        const newReceipt = new UniversalReceipt({
            userEmail: cleanEmail,
            serviceName, 
            transactionId, 
            amountPaid: Number(amountPaid) || 0,
            paymentStatus: paymentStatus || 'Paid'
        });
        const savedReceipt = await newReceipt.save();
        console.log(`💾 Receipt saved on server! ID: ${savedReceipt._id}`);

        let targetPhone = phone || '';
        let targetName = 'Partner / Customer';

        const userDoc = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
        if (userDoc) {
            targetName = userDoc.name || targetName;
            if (userDoc.phone) targetPhone = userDoc.phone;
        }

        if (!targetPhone) {
            const brokerDoc = await BrokerProfile.findOne({ brokerEmail: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
            if (brokerDoc && brokerDoc.phone) targetPhone = brokerDoc.phone;
        }

        if (!targetPhone) {
            const latestVerif = await Verification.findOne({ userEmail: cleanEmail }).sort({ createdAt: -1 });
            if (latestVerif) {
                targetPhone = latestVerif.ownerPhone || latestVerif.tenantPhone || '';
                targetName = latestVerif.ownerName || latestVerif.tenantName || targetName;
            }
        }

        if (targetPhone && Number(amountPaid) > 0) {
            const dateStr = new Date().toLocaleDateString('hi-IN', { 
                day: '2-digit', month: 'short', year: 'numeric', 
                hour: '2-digit', minute: '2-digit' 
            });

            const receiptMsg = `🧾 *पक्की डिजिटल पेमेंट रसीद (Bhopal Properties)*\n\nनमस्ते *${targetName}* जी,\nआपका पेमेंट सर्वर पर सफलतापूर्वक दर्ज हो गया है! 🎉\n\n━━━━━━━━━━━━━━━━━━\n🆔 *रसीद नं:* #${savedReceipt._id.toString().slice(-6).toUpperCase()}\n📌 *सर्विस:* ${serviceName}\n💰 *राशि (Paid):* ₹${amountPaid}\n🔢 *ट्रांजैक्शन ID:* ${transactionId}\n📅 *दिनांक:* ${dateStr}\n✅ *स्टेटस:* ${paymentStatus || 'Paid'} (Verified)\n━━━━━━━━━━━━━━━━━━\n\n📥 आप अपनी रसीद कभी भी हमारे पोर्टल के *My Receipts* सेक्शन से डाउनलोड कर सकते हैं:\n🌐 https://bhopal-real-estate.onrender.com/receipt.html\n\nधन्यवाद! 🙏\n- *Team Bhopal Properties*`;

            sendDirectWhatsApp(targetPhone, receiptMsg)
                .then(() => console.log(`📤 WhatsApp Receipt delivered to customer: ${targetPhone}`))
                .catch(err => console.error("WhatsApp Receipt Error:", err.message));
        }

        res.json({ 
            success: true, 
            receiptId: savedReceipt._id,
            message: "✅ रसीद सर्वर पर सेव हो गई और WhatsApp पर भी भेज दी गई!" 
        });
    } catch (e) { 
        console.error("Save Receipt Error:", e);
        res.status(500).json({ success: false, error: e.message }); 
    }
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

app.get('/api/test-wishes', async (req, res) => {
    console.log("Manual trigger for wishes & festivals...");
    
    if (Object.keys(festivalCache).length === 0) {
        await updateFestivalCalendar();
    }
    
    const forcedFestival = req.query.force === 'true' ? "Deepavali Utsav (Test)" : null;
    await processGreetingsAndWishes(forcedFestival);
    
    res.json({ 
        success: true, 
        message: forcedFestival ? "Forced festival test executed!" : "Wishes check completed!", 
        totalFestivals: Object.keys(festivalCache).length,
        loadedFestivals: festivalCache 
    });
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

app.get('/api/get-profile', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ message: 'Email required' });

        const cleanEmail = email.toLowerCase().trim();
        const profile = await BrokerProfile.findOne({ brokerEmail: cleanEmail });
        const userDoc = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });

        let actualRole = userDoc ? (userDoc.role || 'user') : 'user';
        if (cleanEmail === "devilking786k@sahu.com") actualRole = 'admin';

        // Check karein ki user Employee / Employer / Admin hai ya normal User
        const allowedRoles = ['employee', 'employer', 'agent', 'admin', 'staff', 'field_officer'];
        const isEligibleForIdCard = allowedRoles.includes(actualRole.toLowerCase());

        res.json({
            brokerEmail: cleanEmail,
            name: userDoc ? userDoc.name : '',
            role: actualRole,
            isEligibleForIdCard: isEligibleForIdCard,
            phone: (profile && profile.phone) ? profile.phone : (userDoc ? userDoc.phone : ''),
            photo: profile ? profile.photo : '',
            dealingAreas: profile ? profile.dealingAreas : [],
            dob: profile ? profile.dob : '',
            isProfileComplete: profile ? profile.isProfileComplete : false,
            empId: userDoc ? `BRE-2026-${userDoc._id.toString().slice(-4).toUpperCase()}` : 'BRE-2026-001'
        });
    } catch (error) { 
        res.status(500).json({ message: 'Error' }); 
    }
});

// 🌟 UPGRADED: PROFILE UPDATE ROUTE (Exact Number Targeting + Re-send on Phone Change)
app.post('/api/update-profile', upload.single('profilePhoto'), async (req, res) => {
    try {
        const { brokerEmail, phone, latitude, longitude, dob } = req.body;
        const cleanEmail = brokerEmail ? brokerEmail.toLowerCase().trim() : '';

        if (!cleanEmail) {
            return res.status(400).json({ success: false, message: "Broker Email anivarya hai!" });
        }

        const cleanInputPhone = phone ? phone.trim().replace(/\D/g, '').slice(-10) : '';

        // 🔍 CHECK 1: DUPLICATE PHONE NUMBER CHECK
        if (cleanInputPhone) {
            const existingProfile = await BrokerProfile.findOne({
                phone: { $regex: cleanInputPhone },
                brokerEmail: { $ne: cleanEmail }
            });

            if (existingProfile) {
                return res.status(400).json({ 
                    success: false, 
                    message: "❌ Yeh phone number pehle se kisi aur broker ke account me registered hai! Kripya apna number daalein." 
                });
            }
        }

        let areas = [];
        if (req.body.dealingAreas) {
            try { 
                areas = JSON.parse(req.body.dealingAreas); 
            } catch (e) { 
                areas = Array.isArray(req.body.dealingAreas) ? req.body.dealingAreas : req.body.dealingAreas.split(','); 
            }
        }

        const currentProfile = await BrokerProfile.findOne({ brokerEmail: cleanEmail });
        const oldPhoneClean = (currentProfile && currentProfile.phone) ? currentProfile.phone.replace(/\D/g, '').slice(-10) : '';

        const updateData = { 
            phone: cleanInputPhone || oldPhoneClean, 
            dealingAreas: areas,
            dob: dob ? dob.trim() : ''
        };
        
        if (latitude) updateData.latitude = Number(latitude);
        if (longitude) updateData.longitude = Number(longitude);
        if (req.file) updateData.photo = req.file.path || req.file.url;

        const finalPhoto = updateData.photo || (currentProfile ? currentProfile.photo : '');
        const finalPhone = updateData.phone;
        const finalDOB = updateData.dob || (currentProfile ? currentProfile.dob : '');
        const finalAreas = updateData.dealingAreas && updateData.dealingAreas.length > 0 
            ? updateData.dealingAreas 
            : (currentProfile ? currentProfile.dealingAreas : []);

        // 🔒 CHECK 2: MANDATORY PROFILE COMPLETION
        if (finalPhone && finalPhoto && finalDOB && finalAreas.length > 0) {
            updateData.isProfileComplete = true;
        } else {
            updateData.isProfileComplete = false;
        }

        const isPhoneChanged = Boolean(cleanInputPhone && cleanInputPhone !== oldPhoneClean);
        if (isPhoneChanged) {
            updateData.welcomeSent = false;
        }

        const updatedProfile = await BrokerProfile.findOneAndUpdate(
            { brokerEmail: cleanEmail }, 
            { $set: updateData }, 
            { new: true, upsert: true }
        );

        // 🔗 SYNC: User table me bhi phone number update kar dein taaki Forgot Password me turant mile
        if (finalPhone) {
            await User.updateOne(
                { email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } }, 
                { $set: { phone: finalPhone } }
            );
        }

        // 🚀 LIVE TRIGGER: SEEDHE NAYE PHONE NUMBER (finalPhone) PAR WELCOME MESSAGE BHEJEIN
        if (finalPhone && (!updatedProfile.welcomeSent || isPhoneChanged)) {
            const user = await User.findOne({ email: cleanEmail });
            const brokerName = user ? user.name : 'Partner';

            const welcomeMsg = `नमस्ते ${brokerName} ji! 🙏\n\n*Bhopal Properties Partner Network* में आपका हार्दिक स्वागत है! 🏢✨\n\nआपकी प्रोफाइल सफलतापूर्वक अपडेट हो गई है। अब आप हमारे पोर्टल पर अपनी प्रॉपर्टीज लिस्ट कर सकते हैं, ग्राहकों से सीधे इन्क्वायरी पा सकते हैं, और डिजिटल लेजर का उपयोग कर सकते हैं।\n\nकिसी भी सहायता या जानकारी के लिए हम सदैव आपके साथ हैं। Wishing you great deals and success ahead! 💼🚀\n\n🌐 Portal: https://bhopal-real-estate.onrender.com\n- Team Bhopal Properties`;

            console.log(`📤 Dispatching Welcome WhatsApp to exact number: ${finalPhone}`);

            sendDirectWhatsApp(finalPhone, welcomeMsg)
                .then(async (sent) => {
                    if (sent) {
                        await BrokerProfile.updateOne({ brokerEmail: cleanEmail }, { $set: { welcomeSent: true } });
                        console.log(`✅ Welcome WhatsApp message delivered to Broker: ${brokerName} (${finalPhone})`);
                    }
                })
                .catch(err => console.error("Welcome WhatsApp delivery error:", err.message));
        }

        res.json({ 
            success: true, 
            message: updateData.isProfileComplete 
                ? "✅ प्रोफाइल सफलतापूर्वक पूरी अपडेट हो गई!" 
                : "⚠️ प्रोफाइल सेव हुई, लेकिन कृपया फोटो, फ़ोन, जन्मतिथि और एरिया पूरी तरह भरें।",
            isProfileComplete: updatedProfile.isProfileComplete,
            data: updatedProfile
        });
    } catch (error) { 
        console.error("Profile update error:", error);
        res.status(500).json({ success: false, message: "Server Error" }); 
    }
});

// =========================================================================
// 🔐 WHATSAPP OTP SIGNUP & VERIFICATION ROUTES
// =========================================================================
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        const emailLower = email ? email.toLowerCase().trim() : '';
        const cleanPhone = phone ? phone.trim().replace(/\D/g, '').slice(-10) : '';

        if (!cleanPhone || cleanPhone.length !== 10) {
            return res.status(400).json({ success: false, message: 'कृपया सही 10 अंकों का WhatsApp नंबर डालें!' });
        }

        // 🔍 Check 1: Email pehle se registered to nahi?
        const existingUser = await User.findOne({ email: emailLower });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'यह Email पहले से रजिस्टर्ड है!' });
        }

        // 🔍 Check 2: Phone number pehle se kisi user/broker ke pass to nahi?
        const existingPhoneUser = await User.findOne({ phone: cleanPhone });
        const existingPhoneBroker = await BrokerProfile.findOne({ phone: { $regex: cleanPhone } });
        if (existingPhoneUser || existingPhoneBroker) {
            return res.status(400).json({ success: false, message: 'यह WhatsApp नंबर पहले से किसी अकाउंट में रजिस्टर्ड है!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        
        await PendingUser.deleteMany({ email: emailLower });
        const newPendingUser = new PendingUser({ 
            name, 
            email: emailLower, 
            phone: cleanPhone, 
            password: hashedPassword, 
            otp 
        });
        await newPendingUser.save();

        // 📲 SEND OTP VIA WHATSAPP
        const otpMessage = `🔐 *Bhopal Properties Verification*\n\nनमस्ते *${name}* ji,\nआपका अकाउंट वेरिफिकेशन OTP है: *${otp}*\n\nयह कोड 10 मिनट के लिए मान्य है। कृपया इसे किसी के साथ साझा न करें।\n\n🌐 https://bhopal-real-estate.onrender.com`;
        
        const isSent = await sendDirectWhatsApp(cleanPhone, otpMessage);
        if (!isSent) {
            return res.status(500).json({ 
                success: false, 
                message: 'WhatsApp सर्वर से कनेक्ट नहीं हो पाया। कृपया कुछ सेकंड बाद प्रयास करें।' 
            });
        }
        
        res.json({ 
            success: true, 
            requireOtp: true, 
            message: `✅ आपके WhatsApp नंबर (+91 ${cleanPhone}) पर 4-अंकों का OTP भेज दिया गया है!` 
        });
    } catch (error) { 
        console.error("Signup Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
});

app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const emailLower = email ? email.toLowerCase().trim() : '';
        
        const pendingUser = await PendingUser.findOne({ email: emailLower });
        if (!pendingUser) {
            return res.status(400).json({ success: false, message: '⏰ OTP का समय समाप्त हो गया है! कृपया दोबारा साइनअप करें।' });
        }
        if (pendingUser.otp !== otp.toString().trim()) {
            return res.status(400).json({ success: false, message: '❌ गलत OTP! कृपया अपना WhatsApp चेक करके सही कोड डालें।' });
        }

        // 1. User account create karein
        const newUser = new User({ 
            name: pendingUser.name, 
            email: pendingUser.email, 
            phone: pendingUser.phone,
            password: pendingUser.password, 
            role: 'user' 
        });
        await newUser.save();

        // 2. BrokerProfile me verified phone number pehle se auto-save kar dein
        await BrokerProfile.findOneAndUpdate(
            { brokerEmail: pendingUser.email },
            { $set: { phone: pendingUser.phone } },
            { upsert: true }
        );

        await PendingUser.deleteOne({ email: emailLower });
        res.json({ success: true, message: '🎉 आपका WhatsApp नंबर वेरीफाई हो गया और अकाउंट सफलतापूर्वक बन गया!' });
    } catch (error) { 
        console.error("OTP Verify Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
});

// =========================================================================
// 🔑 SMART FORGOT PASSWORD / FIND USER ID VIA WHATSAPP OTP (UNIVERSAL LOOKUP)
// =========================================================================
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier) {
            return res.status(400).json({ success: false, message: 'कृपया अपना ईमेल या मोबाइल नंबर डालें!' });
        }

        const cleanInput = identifier.toString().trim().toLowerCase();
        const digitsOnly = cleanInput.replace(/\D/g, '').slice(-10);

        let targetEmail = '';
        let targetPhone = '';
        let targetName = 'Partner';

        // 1. Agar user ne Email dala hai
        if (cleanInput.includes('@')) {
            targetEmail = cleanInput;
            const userDoc = await User.findOne({ email: { $regex: new RegExp(`^${cleanInput}$`, 'i') } });
            const brokerDoc = await BrokerProfile.findOne({ brokerEmail: { $regex: new RegExp(`^${cleanInput}$`, 'i') } });
            if (userDoc) {
                targetName = userDoc.name || targetName;
                targetPhone = userDoc.phone || '';
            }
            if (brokerDoc && brokerDoc.phone && !targetPhone) {
                targetPhone = brokerDoc.phone;
            }
        } 
        // 2. Agar user ne 10-digit Mobile Number dala hai
        else if (digitsOnly.length === 10) {
            let brokerProf = await BrokerProfile.findOne({ phone: { $regex: digitsOnly } });
            let userDoc = await User.findOne({ phone: { $regex: digitsOnly } });

            if (brokerProf && brokerProf.brokerEmail) {
                targetEmail = brokerProf.brokerEmail.toLowerCase().trim();
                targetPhone = brokerProf.phone;
            } else if (userDoc) {
                targetEmail = userDoc.email.toLowerCase().trim();
                targetPhone = userDoc.phone;
                targetName = userDoc.name;
            } else {
                const tenantDoc = await TenantLedger.findOne({ mobileNo: { $regex: digitsOnly }, status: 'Active' });
                if (tenantDoc && tenantDoc.tenantEmail) {
                    targetEmail = tenantDoc.tenantEmail.toLowerCase().trim();
                    targetPhone = tenantDoc.mobileNo;
                    targetName = tenantDoc.tenantName;
                }
            }

            if (targetEmail) {
                const uCheck = await User.findOne({ email: targetEmail });
                if (uCheck && uCheck.name) targetName = uCheck.name;
            }
        }

        if (!targetEmail || !targetPhone) {
            return res.status(404).json({ 
                success: false, 
                message: 'इस मोबाइल नंबर या ईमेल से कोई अकाउंट नहीं मिला! कृपया सही डिटेल्स डालें।' 
            });
        }

        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        await PendingUser.deleteMany({ email: targetEmail });
        const resetRecord = new PendingUser({
            name: targetName,
            email: targetEmail,
            phone: targetPhone,
            password: 'PASSWORD_RESET_MODE',
            otp: otp
        });
        await resetRecord.save();

        const resetMsg = `🔑 *Bhopal Properties Account Recovery*\n\nनमस्ते *${targetName}* ji,\nआपकी User ID एवं पासवर्ड रिकवरी का OTP है: *${otp}*\n\nयह कोड 10 मिनट के लिए मान्य है।\n🌐 https://bhopal-real-estate.onrender.com`;

        const isSent = await sendDirectWhatsApp(targetPhone, resetMsg);
        if (!isSent) {
            return res.status(500).json({ success: false, message: 'WhatsApp सर्वर अभी व्यस्त है, कृपया कुछ सेकंड बाद प्रयास करें।' });
        }

        const maskedPhone = targetPhone.slice(-4).padStart(10, '*');
        res.json({ 
            success: true, 
            email: targetEmail,
            message: `✅ आपके WhatsApp नंबर (${maskedPhone}) पर 4-अंकों का OTP भेज दिया गया है!` 
        });
    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// 🔍 STEP 2: VERIFY OTP & REVEAL USER ID (EMAIL)
app.post('/api/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const emailLower = email ? email.toLowerCase().trim() : '';

        const pendingRecord = await PendingUser.findOne({ email: emailLower });
        if (!pendingRecord) {
            return res.status(400).json({ success: false, message: '⏰ OTP एक्सपायर हो गया है! कृपया दोबारा OTP मंगवाएं।' });
        }

        if (pendingRecord.otp !== otp.toString().trim()) {
            return res.status(400).json({ success: false, message: '❌ गलत OTP! कृपया WhatsApp पर आया सही 4-अंकों का कोड डालें।' });
        }

        res.json({
            success: true,
            userId: pendingRecord.email,
            userName: pendingRecord.name,
            message: '✅ OTP वेरीफाई हो गया! नीचे आपकी User ID दी गई है।'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// 🔐 STEP 3: SAVE NEW PASSWORD
app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const emailLower = email ? email.toLowerCase().trim() : '';

        const pendingRecord = await PendingUser.findOne({ email: emailLower });
        if (!pendingRecord) {
            return res.status(400).json({ success: false, message: '⏰ OTP expire ho gaya hai! Kripya dobara OTP mangwayen.' });
        }

        if (pendingRecord.otp !== otp.toString().trim()) {
            return res.status(400).json({ success: false, message: '❌ Galat OTP! Sahi code dalein.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        const updatedUser = await User.findOneAndUpdate(
            { email: { $regex: new RegExp(`^${emailLower}$`, 'i') } },
            { $set: { password: hashedPassword, phone: pendingRecord.phone } },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: '❌ Database me yeh user account nahi mila!' });
        }

        await PendingUser.deleteOne({ email: emailLower });

        if (pendingRecord.phone) {
            const confirmMsg = `✅ *Password Updated Successfully*\n\nNamaste *${pendingRecord.name}* ji,\nAapka naya password successfully save ho gaya hai.\n\n🌐 Login: https://bhopal-real-estate.onrender.com/login.html`;
            sendDirectWhatsApp(pendingRecord.phone, confirmMsg).catch(() => {});
        }

        res.json({ success: true, message: '🎉 Aapka naya password safalpurvak save ho gaya hai!' });
    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// 📲 DIRECT ANDROID APK FORCE-DOWNLOAD ROUTE (FOR QR SCAN & WEBSITE BUTTON)
app.get('/download-app', (req, res) => {
    const path = require('path');
    const apkPath = path.join(__dirname, 'bhopal-real-estate.apk');
    res.download(apkPath, 'Bhopal-Real-Estate.apk', (err) => {
        if (err) {
            console.error("APK Download Error:", err.message);
            res.status(404).send("App file server par upload ho rahi hai, kripya thodi der baad try karein.");
        }
    });
});

// 🌟 UPGRADED: LOGIN ROUTE (100% Accurate Password Check & Sync)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Kripya Email aur Password dono bharein!' });
        }

        const emailLower = email.toLowerCase().trim();

        const user = await User.findOne({ email: { $regex: new RegExp(`^${emailLower}$`, 'i') } });
        if (user) {
            const isMatch = await bcrypt.compare(password, user.password);
            const isPlainMatch = (password === user.password);

            if (!isMatch && !isPlainMatch) {
                return res.status(401).json({ success: false, message: 'Galat Password! Kripya dobara koshish karein.' });
            }

            let actualRole = user.role || 'user';
            if (user.email.toLowerCase() === "devilking786k@sahu.com") actualRole = 'admin';

            const token = jwt.sign({ userId: user._id, role: actualRole, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

            const brokerProf = await BrokerProfile.findOne({ brokerEmail: user.email });
            const isProfileComplete = brokerProf ? Boolean(brokerProf.isProfileComplete) : false;

            if (brokerProf && brokerProf.phone && !brokerProf.welcomeSent) {
                const welcomeMsg = `Namaste ${user.name} ji! 🙏\n\n*Bhopal Properties Partner Network* me aapka hardik swagat hai! 🏢✨\n\nAb aap apne portal par properties list kar sakte hain. Wishing you great deals ahead! 💼🚀\n\n🌐 Portal: https://bhopal-real-estate.onrender.com\n- Team Bhopal Properties`;
                
                sendDirectWhatsApp(brokerProf.phone, welcomeMsg)
                    .then(async (sent) => {
                        if (sent) {
                            brokerProf.welcomeSent = true;
                            await brokerProf.save();
                        }
                    })
                    .catch(() => {});
            }

            return res.json({ 
                success: true, 
                name: user.name, 
                email: user.email, 
                role: actualRole, 
                token: token,
                isProfileComplete: isProfileComplete 
            });
        }

        const tenant = await TenantLedger.findOne({ tenantEmail: { $regex: new RegExp(`^${emailLower}$`, 'i') }, tenantPassword: password });
        if (tenant) {
            const token = jwt.sign({ tenantId: tenant._id, role: 'tenant', email: tenant.tenantEmail }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({ success: true, name: tenant.tenantName, email: tenant.tenantEmail, role: 'tenant', token: token, tenantData: tenant });
        }

        return res.status(401).json({ success: false, message: 'Galat Email ya Password!' });
    } catch (error) { 
        console.error("Login Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
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

// 🔒 GUARDED: Broker must complete profile before adding property draft
app.post('/api/submit-property-draft', upload.array('propertyImages', 3), requireCompleteProfile, async (req, res) => {   
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

// ==========================================
// 🤖 WHATSAPP AI PROPERTY SEARCH BOT ENGINE
// ==========================================
app.post('/api/whatsapp/incoming-bot', async (req, res) => {
    try {
        const { senderPhone, messageText } = req.body;
        if (!senderPhone || !messageText) return res.status(400).json({ success: false });

        const query = messageText.toLowerCase();
        let filter = { status: 'approved' };

        // Location match
        if (query.includes('arera')) filter.location = /arera/i;
        else if (query.includes('new market')) filter.location = /new market/i;
        else if (query.includes('mp nagar')) filter.location = /mp nagar/i;

        // Purpose match (Rent / Sale)
        if (query.includes('rent') || query.includes('kiraye')) filter.purpose = /rent/i;
        else if (query.includes('buy') || query.includes('sale') || query.includes('kharidna')) filter.purpose = /sale/i;

        const matchedProps = await Property.find(filter).limit(3).lean();

        if (matchedProps.length === 0) {
            await sendDirectWhatsApp(senderPhone, `🙏 Namaste! Aapki khoj "${messageText}" ke liye abhi koi property uplabdh nahi hai. Kripya hamari website visit karein: https://bhopal-real-estate.onrender.com`);
        } else {
            let replyMsg = `🏢 *Bhopal Properties AI Bot*\nAapki talash ke anusaar yeh top properties milti hain:\n\n`;
            matchedProps.forEach((p, index) => {
                const propUrl = `https://bhopal-real-estate.onrender.com/property-details.html?id=${p._id}`;
                replyMsg += `${index + 1}. *${p.title || 'Property'}*\n📍 Location: ${p.location}\n💰 Price: ₹${p.price}\n🔗 Dekhein: ${propUrl}\n\n`;
            });
            replyMsg += `📞 Adhik jankari ke liye call karein ya website par visit karein!`;
            
            await sendDirectWhatsApp(senderPhone, replyMsg);
        }

        res.json({ success: true, message: "Bot response sent successfully!" });
    } catch (err) {
        console.error("WhatsApp Bot Error:", err);
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
    updateFestivalCalendar();
});