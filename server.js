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
// ☁️ CLOUDINARY SETUP 
// ==========================================
cloudinary.config({
    cloud_name: 'duy3ipjoj',
    api_key: '228275812572669',
    api_secret: '0VVartpd4kavLNXs66kmCAmUeCI'
});

// 📷 Images ke liye normal Cloudinary Storage setup
const imageStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'bhopal_properties',
        allowedFormats: ['jpg', 'png', 'jpeg', 'webp']
    }
});
const upload = multer({ storage: imageStorage });

// 📄 PDFs ke liye Memory Storage setup taaki binary buffer direct upload ho sake
const pdfUpload = multer({ storage: multer.memoryStorage() });

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
    views: { type: Number, default: 0 }, clicks: { type: Number, default: 0 },
    transactionId: { type: String, default: 'FREE_BYPASS' },
    amountPaid: { type: Number, default: 0 },
    paymentStatus: { type: String, default: 'Free' }
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);

const brokerProfileSchema = new mongoose.Schema({
    brokerEmail: { type: String, unique: true, required: true },
    phone: String, photo: String, dealingAreas: [String]
}, { timestamps: true });
const BrokerProfile = mongoose.model('BrokerProfile', brokerProfileSchema);

// 👮 UPGRADED Verification Schema (With Status and Txn Tracking)
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
    status: { type: String, default: 'Pending' }, // Pending / Complete / Done
    transactionId: { type: String, default: '' }
}, { timestamps: true });
const Verification = mongoose.model('Verification', verificationSchema);

// 📄 NEW SCHEMA: Rent Agreement Model Configuration
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
    status: { type: String, default: 'Complete' } // Realtime download enabled immediately
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
// 🏠 Tenant Ledger Schema (रेंट, बिजली यूनिट और डिजिटल खाता के लिए)
// 🏠 Advanced Tenant Ledger Schema (As per User Excel Image)
const TenantLedgerSchema = new mongoose.Schema({
    ownerEmail: { type: String, required: true },
    tenantName: { type: String, required: true },
    tenantEmail: { type: String, required: true }, // लॉगिन के लिए
    tenantPassword: { type: String, required: true },
    roomOrFlatNo: { type: String, required: true },
    mobileNo: { type: String },
    
    // 💵 Financial Fields
    balanceOpening: { type: Number, default: 0 }, // पुराना बकाया
    monthlyRent: { type: Number, default: 0 },
    totalRentDue: { type: Number, default: 0 }, // Opening Balance + Monthly Rent
    
    // ⚡ Electricity Fields
    previousUnitReading: { type: Number, default: 0 },
    currentUnitReading: { type: Number, default: 0 },
    totalUnitConsumption: { type: Number, default: 0 }, // (Curr - Prev)
    unitRate: { type: Number, default: 0 },
    totalElectricityBill: { type: Number, default: 0 }, // (Consumption * Rate)
    
    // 💧 Other Charges & Totals
    waterOrOtherCharges: { type: Number, default: 0 },
    totalAmountPayable: { type: Number, default: 0 }, // Rent Due + Elec Bill + Other Charges
    amountReceived: { type: Number, default: 0 },
    paymentMode: { type: String, enum: ['Cash', 'UPI/Online', 'Check', 'Unpaid'], default: 'Unpaid' }, // 🔥 NAYA COLUMN
    remainderBalance: { type: Number, default: 0 }, // Payable - Received
    
    // 🔒 Status & Security Locks
    status: { type: String, enum: ['Active', 'Left'], default: 'Active' }, // 🔥 NAYA: 'Left' होने पर परमानेंट लॉक रहेगा
    isLocked: { type: Boolean, default: false }, // मैन्युअल या ऑटो लॉक के लिए
    lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

const TenantLedger = mongoose.model('TenantLedger', TenantLedgerSchema);

// ==========================================
// 3️⃣ API ROUTES
// ==========================================

// -- NEW: Rent Agreement Save Endpoint Matrix --
app.post('/api/save-rent-agreement', async (req, res) => {
    try {
        const { userEmail, agreementData } = req.body;
        const newAgreement = new RentAgreement({
            userEmail: userEmail.toLowerCase().trim(),
            ...agreementData
        });
        await newAgreement.save();
        res.json({ success: true, message: '✅ Rent Agreement safely archived!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// -- NEW: Live Real-time Status Tracker Engine Router --
app.get('/api/user/my-verifications', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ success: false, message: "Email parameter missing" });
        
        // Database se data load karega live updates dashboard par bhejne ke liye
        const data = await Verification.find({ userEmail: email.toLowerCase().trim() }).sort({ createdAt: -1 });
        res.json({ success: true, data: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// -- UNIVERSAL AUTOMATED RECEIPT APIs --
app.post('/api/save-receipt', async (req, res) => {
    try {
        const { userEmail, serviceName, transactionId, amountPaid, paymentStatus } = req.body;
        const newReceipt = new UniversalReceipt({
            userEmail: userEmail.toLowerCase().trim(),
            serviceName,
            transactionId,
            amountPaid,
            paymentStatus: paymentStatus || 'Paid'
        });
        await newReceipt.save();
        res.json({ success: true, message: "Receipt generated automatically!" });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/my-receipts', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).json({ success: false, message: "Email required" });
        const receipts = await UniversalReceipt.find({ userEmail: email.toLowerCase().trim() }).sort({ createdAt: -1 });
        res.json({ success: true, receipts });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// -- SUPER APP SERVICES TRACKER APIs --
app.post('/api/track-service/:serviceName', async (req, res) => {
    try {
        const serviceName = req.params.serviceName;
        await ServiceAnalytics.findOneAndUpdate(
            { serviceName: serviceName },
            { $inc: { clicks: 1 } },
            { new: true, upsert: true }
        );
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/service-analytics', async (req, res) => {
    try {
        const analytics = await ServiceAnalytics.find({}).sort({ clicks: -1 });
        res.json({ success: true, data: analytics });
    } catch(e) {
        res.status(500).json({ success: false });
    }
});

// -- PAYMENT BYPASS APIs --
app.get('/api/payment-status', async (req, res) => {
    try {
        const bypassConfig = await Config.findOne({ key: 'bypassPayment' });
        const isBypassed = bypassConfig ? bypassConfig.value : false;
        res.json({ success: true, isPaymentBypassed: isBypassed });
    } catch (e) {
        res.status(500).json({ success: false, isPaymentBypassed: false });
    }
});

app.post('/api/admin/toggle-payment', async (req, res) => {
    try {
        const { bypass } = req.body;
        await Config.findOneAndUpdate(
            { key: 'bypassPayment' },
            { value: bypass },
            { new: true, upsert: true }
        );
        res.json({ success: true, message: bypass ? "Payment BYPASSED (Free Mode Active) 🔓" : "Payment ENABLED (Paid Mode Active) 💳" });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// -- USER APIs (Multi-File Field Handler for Tenant Verification) --
app.post('/api/submit-verification', upload.fields([
    { name: 'tenantPhoto', maxCount: 1 },
    { name: 'aadharFront', maxCount: 1 },
    { name: 'aadharBack', maxCount: 1 }
]), async (req, res) => {
    try {
        const tenantPhotoUrl = req.files && req.files['tenantPhoto'] ? req.files['tenantPhoto'][0].path : 'https://placehold.co/150x150?text=No+Photo';
        const aadharFrontUrl = req.files && req.files['aadharFront'] ? req.files['aadharFront'][0].path : '';
        const aadharBackUrl = req.files && req.files['aadharBack'] ? req.files['aadharBack'][0].path : '';

        // Random transaction target map placeholder if not passed by payment payload
        const targetTxn = req.body.transactionId || 'FREE_VERIFY_' + Math.random().toString(36).substring(2, 10).toUpperCase();

        const verificationData = { 
            ...req.body, 
            tenantPhoto: tenantPhotoUrl,
            aadharFrontPhoto: aadharFrontUrl,
            aadharBackPhoto: aadharBackUrl,
            status: 'Pending', // Default state locked to pending tracking sequence
            transactionId: targetTxn
        };

        const newRequest = new Verification(verificationData);
        await newRequest.save();

        const latestProfile = await BrokerProfile.findOne({}).sort({ updatedAt: -1 });
        let activeAgentPhone = "919575611622"; 

        if (latestProfile && latestProfile.phone) {
            activeAgentPhone = latestProfile.phone.replace(/\D/g, '');
            if (activeAgentPhone.length === 10) {
                activeAgentPhone = "91" + activeAgentPhone;
            }
        }

        res.json({ 
            success: true, 
            message: '✅ आपकी रिक्वेस्ट सफलतापूर्ण सबमिट हो गई है!',
            agentPhone: activeAgentPhone 
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

// 🗑️ User Only Delete Property API
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
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
});

// -- POLICE AGENT APIs --
app.get('/api/admin/verifications', async (req, res) => {
    try {
        const requests = await Verification.find({ status: 'Pending' }).sort({ createdAt: -1 }); 
        res.json({ success: true, requests });
    } catch (error) { res.status(500).json({ success: false }); }
});

// 👮 FIXED AGENT ROUTE: जब एजेंट फाइल सबमिट करेगा तो स्टेटस 'Complete' होगा और पीडीएफ डैशबोर्ड पर चमकेगी!
app.post('/api/admin/upload-verification-doc/:id', pdfUpload.single('verificationDoc'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'bhopal_properties_docs',
                    resource_type: 'auto',
                    format: 'pdf',          
                    public_id: `Verification_${req.params.id}_${Date.now()}`
                },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                }
            );
            uploadStream.end(req.file.buffer);
        });

        const docUrl = uploadResult.secure_url || uploadResult.url;
        
        // 🔥 UPDATE STATUS TO 'Complete': ताकि यूजर के स्क्रीन पर पेंडिंग की जगह तुरंत कंप्लीट दिखे
        await Verification.findByIdAndUpdate(req.params.id, { status: 'Complete', documentUrl: docUrl });
        res.json({ success: true, message: '✅ PDF Uploaded and Status marked as Complete!' });
    } catch (error) { 
        console.error("Cloudinary Upload Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
});

app.post('/api/admin/change-verification-status/:id', async (req, res) => {
    try {
        await Verification.findByIdAndUpdate(req.params.id, { status: req.body.newStatus });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// -- OTHER GENERAL APIs --
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

// 🎈 RK Baloon Dashboard ke liye Image Upload Route
app.post('/api/rk-upload-image', upload.single('rkImage'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const uploadedUrl = req.file.path || req.file.url;
        return res.json({ success: true, url: uploadedUrl });
    } catch (error) {
        console.error("Cloudinary upload error:", error);
        return res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.post('/api/rk-add-package', async (req, res) => {
    try {
        const { category, packageData } = req.body;
        packageData.status = 'published'; 
        await mongoose.connection.db.collection(`${category}_cards`).insertOne(packageData);
        res.json({ success: true, message: 'Package uploaded successfully to local db!' });
    } catch (error) {
        console.error("DB Save Error:", error);
        res.status(500).json({ success: false, message: 'Database Save Failed' });
    }
});

app.get('/api/rk-get-packages/:category', async (req, res) => {
    try {
        const { category } = req.params;
        const items = await mongoose.connection.db.collection(`${category}_cards`).find({}).sort({ id: -1 }).toArray();
        res.json({ success: true, data: items });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Fetch Failed' });
    }
});

app.put('/api/rk-edit-package', async (req, res) => {
    try {
        const { category, id, updateData } = req.body;
        const { ObjectId } = require('mongodb');
        await mongoose.connection.db.collection(`${category}_cards`).updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        res.json({ success: true, message: 'Package updated successfully!' });
    } catch (error) {
        console.error("DB Update Error:", error);
        res.status(500).json({ success: false, message: 'Edit Process Failed' });
    }
});

app.post('/api/rk-toggle-status', async (req, res) => {
    try {
        const { category, id, status } = req.body;
        const { ObjectId } = require('mongodb');
        await mongoose.connection.db.collection(`${category}_cards`).updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: status } }
        );
        res.json({ success: true, message: 'Status switched successfully!' });
    } catch (error) {
        console.error("Status Toggle Error:", error);
        res.status(500).json({ success: false });
    }
});

app.delete('/api/rk-delete-package/:category/:id', async (req, res) => {
    try {
        const { category, id } = req.params;
        const { ObjectId } = require('mongodb');
        await mongoose.connection.db.collection(`${category}_cards`).deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: 'Package deleted successfully from local db!' });
    } catch (error) {
        console.error("DB Delete Error:", error);
        res.status(500).json({ success: false, message: 'Delete Operation Failed' });
    }
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

// RAZORPAY SETUP
const razorpay = new Razorpay({ key_id: 'rzp_test_T3oTzNzTDvWgUL', key_secret: '8VyNa1vXyBiGjtbp5j3DRVr2' });
app.post('/api/create-order', async (req, res) => {
    try {
        const orderAmount = req.body && req.body.customAmount ? req.body.customAmount : 1000; 
        const order = await razorpay.orders.create({ amount: orderAmount, currency: "INR", receipt: "receipt_" + Math.random().toString(36).substring(7) });
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

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const emailLower = email.toLowerCase().trim();

        // 💼 STEP 1: पहले मुख्य User कलेक्शन (Owner/Admin/Broker) में चेक करें
        const user = await User.findOne({ email: emailLower, password });
        
        if (user) {
            let actualRole = user.role || 'user';
            if (user.email === "devilking786k@sahu.com") actualRole = 'admin';
            return res.json({ success: true, name: user.name, email: user.email, role: actualRole });
        }

        // 🚪 STEP 2: अगर मुख्य यूजर लिस्ट में नहीं मिला, तो TenantLedger (किरायेदार खाता) में चेक करें
        const tenant = await TenantLedger.findOne({ tenantEmail: emailLower, tenantPassword: password });
        
        if (tenant) {
            return res.json({ 
                success: true, 
                name: tenant.tenantName, 
                email: tenant.tenantEmail, 
                role: 'tenant',
                tenantData: tenant // फ्रंटएंड रिडायरेक्शन के लिए पूरा डेटा भेजा
            });
        }

        // ❌ STEP 3: अगर दोनों कलेक्शन में कहीं नहीं मिला
        return res.status(401).json({ success: false, message: 'गलत ईमेल या पासवर्ड!' });

    } catch (error) { 
        console.error("Login Router Error:", error);
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
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

// SMART DELETE APIs
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
// 1️⃣ OWNER API: मकान मालिक नया किरायेदार जोड़ेगा या उसका डेटा अपडेट करेगा
// ==========================================
// 🏠 TENANT LEDGER UPSERT & LOCK ROUTE
// ==========================================
app.post('/api/owner/upsert-tenant-ledger', async (req, res) => {
    try {
        const ownerEmail = req.body.ownerEmail;
        const tenantEmail = req.body.tenantEmail;
        const tenantName = req.body.tenantName;
        const tenantPassword = req.body.tenantPassword;
        const roomOrFlatNo = req.body.roomOrFlatNo;
        const mobileNo = req.body.mobileNo;
        const balanceOpening = req.body.balanceOpening;
        const monthlyRent = req.body.monthlyRent;
        const previousUnitReading = req.body.previousUnitReading;
        const currentUnitReading = req.body.currentUnitReading;
        const unitRate = req.body.unitRate;
        const waterOrOtherCharges = req.body.waterOrOtherCharges;
        const amountReceived = req.body.amountReceived;
        const paymentMode = req.body.paymentMode;
        const status = req.body.status;
        const lockRecord = req.body.lockRecord;

        let tenant = await TenantLedger.findOne({ ownerEmail: ownerEmail, tenantEmail: tenantEmail });

        const rentOpening = Number(balanceOpening || 0);
        const rentMon = Number(monthlyRent || 0);
        const totalRentDue = rentOpening + rentMon;

        const prevRead = Number(previousUnitReading || 0);
        const currRead = Number(currentUnitReading || 0);
        const totalUnitConsumption = Math.max(0, currRead - prevRead);
        const rate = Number(unitRate || 0);
        const totalElectricityBill = totalUnitConsumption * rate;

        const other = Number(waterOrOtherCharges || 0);
        const totalAmountPayable = totalRentDue + totalElectricityBill + other;
        const recAmount = Number(amountReceived || 0);
        const remainderBalance = totalAmountPayable - recAmount;

        if (tenant) {
            if (tenant.isLocked || tenant.status === 'Left') {
                return res.status(403).json({ 
                    success: false, 
                    message: '❌ Record locked h! Isme badlav nahi kiya ja sakta.' 
                });
            }

            tenant.tenantName = tenantName;
            if (tenantPassword) tenant.tenantPassword = tenantPassword;
            tenant.roomOrFlatNo = roomOrFlatNo;
            tenant.mobileNo = mobileNo;
            tenant.balanceOpening = rentOpening;
            tenant.monthlyRent = rentMon;
            tenant.totalRentDue = totalRentDue;
            tenant.previousUnitReading = prevRead;
            tenant.currentUnitReading = currRead;
            tenant.totalUnitConsumption = totalUnitConsumption;
            tenant.unitRate = rate;
            tenant.totalElectricityBill = totalElectricityBill;
            tenant.waterOrOtherCharges = other;
            tenant.totalAmountPayable = totalAmountPayable;
            tenant.amountReceived = recAmount;
            tenant.paymentMode = paymentMode;
            tenant.status = status;

            if (lockRecord === true || status === 'Left') {
                tenant.isLocked = true;
            }

            tenant.lastUpdated = Date.now();
            await tenant.save();
        } else {
            const isLockedInit = (lockRecord === true || status === 'Left');
            tenant = new TenantLedger({
                ownerEmail: ownerEmail,
                roomOrFlatNo: roomOrFlatNo,
                tenantEmail: tenantEmail.toLowerCase().trim(),
                tenantPassword: tenantPassword,
                tenantName: tenantName,
                mobileNo: mobileNo,
                balanceOpening: rentOpening,
                monthlyRent: rentMon,
                totalRentDue: totalRentDue,
                previousUnitReading: prevRead,
                currentUnitReading: currRead,
                totalUnitConsumption: totalUnitConsumption,
                unitRate: rate,
                totalElectricityBill: totalElectricityBill,
                waterOrOtherCharges: other,
                totalAmountPayable: totalAmountPayable,
                amountReceived: recAmount,
                paymentMode: paymentMode,
                status: status,
                isLocked: isLockedInit
            });
            await tenant.save();
        }

        res.json({ 
            success: true, 
            message: (status === 'Left' || lockRecord) 
                ? '🔒 Record ko locked aur archive kar diya gaya h!' 
                : '✅ Data safely saved!' 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server Side Error' });
    }
});

// 2️⃣ OWNER API: मालिक अपने सभी किरायेदारों की लिस्ट देख सके
app.get('/api/owner/my-tenants', async (req, res) => {
    try {
        const { email } = req.query;
        const tenants = await TenantLedger.find({ ownerEmail: email });
        res.json({ success: true, data: tenants });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 3️⃣ TENANT PORTAL: किरायेदार का डायरेक्ट लॉगिन राउट
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

// 4️⃣ TENANT API: किरायेदार लॉगिन होने के बाद अपना रीयल-टाइम डेटा बिना एडिट ऑप्शन के देख सके
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is LIVE on port ${PORT}`));