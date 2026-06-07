const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Cloudinary Setup
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

// Database Connection
const mongoURI = 'mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/?appName=Cluster0';
mongoose.connect(mongoURI, { family: 4 })
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

// Property Schema
const propertySchema = new mongoose.Schema({
    title: String, purpose: String, location: String, price: Number, desc: String,
    images: [String], videoLink: String, brokerEmail: String,
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    status: { type: String, default: 'pending' }
}, { timestamps: true });
const Property = mongoose.model('Property', propertySchema);

// ==========================================
// 🚀 ALL API ROUTES
// ==========================================

// 1. Get Property (Increments View Count)
app.get('/api/get-property/:id', async (req, res) => {
    try {
        const property = await Property.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
        res.json({ success: true, property: property });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 2. Track Clicks (Calls/WhatsApp)
app.post('/api/track-click/:id', async (req, res) => {
    try {
        await Property.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 3. Update Property (With Images)
app.post('/api/update-property/:id', upload.array('propertyImages', 3), async (req, res) => {
    try {
        const updateData = { ...req.body };
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(f => f.path);
        }
        await Property.findByIdAndUpdate(req.params.id, updateData);
        res.json({ success: true, message: 'Property Updated!' });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 4. Other Routes (Add Property)
app.post('/api/add-property', upload.array('propertyImages', 3), async (req, res) => {
    try {
        const imageUrls = req.files.map(f => f.path);
        const newProp = new Property({ ...req.body, images: imageUrls });
        await newProp.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 5. Basic Get Properties
app.get('/api/get-properties', async (req, res) => {
    const email = req.query.email;
    const props = email ? await Property.find({ brokerEmail: email }) : await Property.find({ status: 'approved' });
    res.json(props);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));