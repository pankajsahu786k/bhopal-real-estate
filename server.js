const express = require('express');
const path = require('path');
const mongoose = require('mongoose'); // डेटाबेस टूल को बुलाना
const multer = require('multer'); // 💡 फोटो अपलोड संभालने वाला टूल
const fs = require('fs'); // फ़ोल्डर चेक करने के लिए टूल
const app = express();
const PORT = process.env.PORT || 3000; // Render के लिए पोर्ट को डायनेमिक रखा है

// फॉर्म और JSON डेटा को समझने के लिए मिडलवेयर
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 💡 सुनिश्चित करना कि 'uploads' नाम का फ़ोल्डर कंप्यूटर/सर्वर पर मौजूद हो
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// 💡 मल्टार (Multer) की सेटिंग: फोटो कहाँ और किस नाम से सेव होगी
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // सारी फ़ोटोज़ 'uploads' फ़ोल्डर में जाएँगी
    },
    filename: function (req, file, cb) {
        // फोटो का नाम यूनिक बनाने के लिए टाइमस्टैम्प जोड़ना (जैसे: 17171717-home.jpg)
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 💡 इंटरनेट पर अपलोड की गई फ़ोटोज़ को सीधे देखने की अनुमति देना
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB डेटाबेस से कनेक्शन जोड़ना
mongoose.connect('mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/bhopal_real_estate?retryWrites=true&w=majority&appName=Cluster0', {
    tls: true,
    tlsAllowInvalidCertificates: true // क्लाउड सर्वर पर कनेक्शन एरर रोकने के लिए
})
.then(() => console.log('MongoDB Atlas (क्लाउड डेटाबेस) से कनेक्शन सफल हो गया! 🚀'))
.catch(err => console.error('डेटाबेस कनेक्शन एरर:', err));

// 1. यूज़र (Broker) का डेटा कैसा दिखेगा (User Schema)
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: String
});
const User = mongoose.model('User', userSchema);

// 2. प्रॉपर्टी का डेटा कैसा दिखेगा (Property Schema)
const propertySchema = new mongoose.Schema({
    title: String,
    purpose: String,
    location: String,
    price: Number,
    desc: String,
    image: String // 💡 नया फ़ील्ड: फोटो का रास्ता स्टोर करने के लिए
});
const Property = mongoose.model('Property', propertySchema);

// यह सर्वर को आपकी HTML और CSS फाइलों को रीड करने की अनुमति देता है
app.use(express.static(__dirname));

// जब कोई हमारी वेबसाइट खोलेगा, तो उसे होम पेज दिखेगा
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// लॉगिन पेज का रास्ता
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// डैशबोर्ड पेज का रास्ता
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// नए ब्रोकर का रजिस्ट्रेशन (Sign-Up) करने का रास्ता
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

        console.log(`---- नया ब्रोकर रजिस्टर्ड हुआ: ${name} (${cleanEmail}) ----`);
        res.json({ success: true, message: 'आपका अकाउंट सफलतापूर्वक बन गया है! अब लॉगिन करें।' });
    } catch (error) {
        console.error("साइन-अप में एरर:", error);
        res.json({ success: false, message: 'अकाउंट बनाने में कोई तकनीकी खराबी आई।' });
    }
});

// लॉगिन चेक करने का असली बैकएंड कोड (डेटाबेस के साथ)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const cleanEmail = email.toLowerCase().trim();

        const user = await User.findOne({ email: cleanEmail });

        if (user && user.password === password) {
            res.json({ success: true, message: `लॉगिन सफल रहा! स्वागत है ${user.name}`, name: user.name });
        } else {
            res.json({ success: false, message: 'गलत ईमेल या密码! कृपया दोबारा जाँचें।' });
        }
    } catch (error) {
        console.error("लॉगिन सर्वर एरर:", error);
        res.status(500).json({ success: false, message: 'लॉगिन के समय सर्वर में गड़बड़ हुई।' });
    }
});

// 💡 नयी प्रॉपर्टी को फोटो के साथ डेटाबेस में सेव करने का नया रास्ता
app.post('/api/add-property', upload.single('propertyImage'), async (req, res) => {
    try {
        const { title, purpose, location, price, desc } = req.body;
        
        // अगर यूजर ने फोटो अपलोड की है तो उसका सही रास्ता निकालना वरना डिफॉल्ट इमेज डालना
        const imagePath = req.file ? `/uploads/${req.file.filename}` : 'https://via.placeholder.com/350';

        // डेटाबेस में नया डॉक्यूमेंट फोटो के लिंक के साथ बनाना
        const newProperty = new Property({ 
            title, 
            purpose, 
            location, 
            price: Number(price), 
            desc, 
            image: imagePath 
        });
        
        await newProperty.save(); // मोंगोडीबी की तिजोरी में लॉक करना

        console.log("---- नयी प्रॉपर्टी फोटो के साथ DATABASE में सेव हो गई! ----");
        res.json({ success: true, message: 'प्रॉपर्टी फोटो के साथ सफलतापूर्वक अपलोड हो गई!' });
    } catch (error) {
        console.error("सेव करने में एरर आई:", error);
        res.json({ success: false, message: 'डेटाबेस में सेव नहीं हो पाया।' });
    }
});

// डेटाबेस से सारी प्रॉपर्टीज निकालकर डैशबोर्ड को भेजने का रास्ता
app.get('/api/get-properties', async (req, res) => {
    try {
        const properties = await Property.find(); 
        res.json(properties);
    } catch (error) {
        res.status(500).json({ message: 'डेटा लाने में गड़बड़ हुई' });
    }
});

// सर्वर को एक्टिवेट करना
app.listen(PORT, () => {
    console.log(`Server चालू हो गया है! पोर्ट नंबर: ${PORT}`);
});