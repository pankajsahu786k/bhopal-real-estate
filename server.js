const express = require('express');
const path = require('path');
const mongoose = require('mongoose'); // डेटाबेस टूल को बुलाना
const app = express();
const PORT = 3000;

// फॉर्म और JSON डेटा को समझने के लिए मिडलवेयर
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB डेटाबेस से कनेक्शन जोड़ना
mongoose.connect('mongodb+srv://pankajsahu786k_db_user:jfijZKkfYPkRBx7w@cluster0.sfsijiz.mongodb.net/bhopal_real_estate?retryWrites=true&w=majority&appName=Cluster0')
.then(() => console.log('MongoDB Atlas (क्लाउड डेटाबेस) से कनेक्शन सफल हो गया! 🚀'))
.catch(err => console.error('डेटाबेस कनेक्शन एरर:', err));

// 1. यूज़र (Broker) का डेटा कैसा दिखेगा (User Schema)
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    password: String
});
const User = mongoose.model('User', userSchema);

// 2. प्रॉपर्टी का डेटा कैसा दिखेगा (Property Schema - जो बीच में कट गया था)
const propertySchema = new mongoose.Schema({
    title: String,
    purpose: String,
    location: String,
    price: Number,
    desc: String
});
const Property = mongoose.model('Property', propertySchema);

// यह सर्वर को आपकी HTML और CSS फाइलों को रीड करने की अनुमति देता है
app.use(express.static(__dirname));

// जब कोई हमारी वेबसाइट खोलेगा, तो उसे होम पेज दिखेगा
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// नए ब्रोकर का रजिस्ट्रेशन (Sign-Up) करने का रास्ता
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // पहले चेक करना कि इस ईमेल से कोई और अकाउंट तो नहीं है
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.json({ success: false, message: 'यह ईमेल आईडी पहले से रजिस्टर्ड है!' });
        }

        // डेटाबेस में नया यूज़र सेव करना
        const newUser = new User({ name, email, password });
        await newUser.save();

        console.log(`---- नया ब्रोकर रजिस्टर्ड हुआ: ${name} (${email}) ----`);
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

        // डेटाबेस में ईमेल ढूंढना
        const user = await User.findOne({ email });

        // अगर ईमेल मिल गया और पासवर्ड भी मैच हो गया
        if (user && user.password === password) {
            res.json({ success: true, message: `लॉगिन सफल रहा! स्वागत है ${user.name}` });
        } else {
            res.json({ success: false, message: 'गलत ईमेल या पासवर्ड! कृपया दोबारा जाँचें।' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'लॉगिन के समय सर्ver में गड़बड़ हुई।' });
    }
});

// नई प्रॉपर्टी को डेटाबेस की तिजोरी में सेव करने का रास्ता
app.post('/api/add-property', async (req, res) => {
    try {
        const { title, purpose, location, price, desc } = req.body;

        // डेटाबेस में नया डॉक्यूमेंट बनाना
        const newProperty = new Property({ title, purpose, location, price, desc });
        await newProperty.save(); // तिजोरी में लॉक करना

        console.log("---- नयी प्रॉपर्टी DATABASE में सेव हो गई! ----");
        res.json({ success: true, message: 'प्रॉपर्टी डेटाबेस में सुरक्षित अपलोड हो गई!' });
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
    console.log(`Server चालू हो गया है! इस लिंक पर जाएँ: http://localhost:${PORT}`);
});