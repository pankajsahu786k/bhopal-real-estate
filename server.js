const express = require('express');
const path = require('path');
const mongoose = require('mongoose'); // डेटाबेस टूल
const multer = require('multer'); // फोटो अपलोड संभालने वाला टूल
const fs = require('fs'); // फ़ोल्डर चेक करने के लिए टूल
const app = express();
const PORT = process.env.PORT || 3000;

// फॉर्म और JSON डेटा को समझने के लिए मिडलवेयर
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// सुनिश्चित करना कि 'uploads' नाम का फ़ोल्डर सर्वर पर मौजूद हो
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// मल्टार (Multer) की सेटिंग
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// अपलोड की गई फ़ोटोज़ को सीधे देखने की अनुमति देना
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB डेटाबेस से कनेक्शन जोड़ना
mongoose.connect('mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/bhopal_real_estate?retryWrites=true&w=majority&appName=Cluster0', {
    tls: true,
    tlsAllowInvalidCertificates: true
})
.then(() => console.log('MongoDB Atlas से कनेक्शन सफल! 🚀'))
.catch(err => console.error('डेटाबेस कनेक्शन एरर:', err));

// 1. यूज़र Schema
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: String
});
const User = mongoose.model('User', userSchema);

// 2. प्रॉपर्टी Schema (brokerEmail के साथ)
const propertySchema = new mongoose.Schema({
    title: String,
    purpose: String,
    location: String,
    price: Number,
    desc: String,
    image: String,
    brokerEmail: String // प्राइवेसी के लिए मुख्य फ़ील्ड
});
const Property = mongoose.model('Property', propertySchema);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// साइन-अप रास्ता
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const cleanEmail = email.toLowerCase().trim();

        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.json({ success: false, message: 'यह ईमेल आईडी पहले से रजिस्टर्ड है!' });
        }

        const newUser = new User({ name, email: cleanEmail, password });
        await newUser.save();
        res.json({ success: true, message: 'आपका अकाउंट सफलतापूर्वक बन गया है! अब लॉगिन करें।' });
    } catch (error) {
        res.json({ success: false, message: 'अकाउंट बनाने में कोई तकनीकी खराबी आई।' });
    }
});

// लॉगिन रास्ता (नाम रिस्पॉन्स में भेजने के साथ)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const cleanEmail = email.toLowerCase().trim();
        const user = await User.findOne({ email: cleanEmail });

        if (user && user.password === password) {
            res.json({ success: true, message: `लॉगिन सफल रहा!`, name: user.name });
        } else {
            res.json({ success: false, message: 'गलत ईमेल या पासवर्ड! कृपया दोबारा जाँचें।' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'लॉगिन के समय सर्वर में गड़बड़ हुई।' });
    }
});

// प्रॉपर्टी ऐड करने का रास्ता (Email लॉक करने के साथ)
app.post('/api/add-property', upload.single('propertyImage'), async (req, res) => {
    try {
        const { title, purpose, location, price, desc, brokerEmail } = req.body;
        const imagePath = req.file ? `/uploads/${req.file.filename}` : 'https://via.placeholder.com/350';

        const newProperty = new Property({ 
            title, purpose, location, price: Number(price), desc, image: imagePath,
            brokerEmail: brokerEmail ? brokerEmail.toLowerCase().trim() : ''
        });
        await newProperty.save();
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक अपलोड हो गई!' });
    } catch (error) {
        res.json({ success: false, message: 'डेटाबेस में सेव नहीं हो पाया।' });
    }
});

// प्राइवेसी फिल्टर के साथ प्रॉपर्टीज भेजने का रास्ता
app.get('/api/get-properties', async (req, res) => {
    try {
        const brokerEmail = req.query.email;
        let properties = [];
        if (brokerEmail) {
            properties = await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() });
        }
        res.json(properties);
    } catch (error) {
        res.status(500).json({ message: 'डेटा लाने में गड़बड़ हुई' });
    }
});

// डिलीट रास्ता
app.delete('/api/delete-property/:id', async (req, res) => {
    try {
        await Property.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक डिलीट हो गई!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'सर्वर एरर।' });
    }
});

// सिंगल प्रॉपर्टी ढूंढना (Edit के लिए)
app.get('/api/get-property/:id', async (req, res) => {
    try {
        const property = await Property.findById(req.params.id);
        res.json(property);
    } catch (error) {
        res.status(500).json({ message: 'डेटा खोजने में गड़बड़ हुई' });
    }
});

// अपडेट रास्ता
app.post('/api/update-property/:id', upload.single('propertyImage'), async (req, res) => {
    try {
        const { title, purpose, location, price, desc } = req.body;
        const oldProperty = await Property.findById(req.params.id);
        let imagePath = oldProperty.image;
        if (req.file) imagePath = `/uploads/${req.file.filename}`;

        await Property.findByIdAndUpdate(req.params.id, {
            title, purpose, location, price: Number(price), desc, image: imagePath
        });
        res.json({ success: true, message: 'प्रॉपर्टी सफलतापूर्वक अपडेट हो गई!' });
    } catch (error) {
        res.json({ success: false, message: 'अपडेट करने में गड़बड़ हुई।' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));