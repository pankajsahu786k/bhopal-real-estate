// 🎯 प्राइवेसी + पब्लिक व्यू दोनों के लिए परफेक्ट प्रॉपर्टी गेट रूट
app.get('/api/get-properties', async (req, res) => {
    try {
        const brokerEmail = req.query.email;
        let properties = [];
        
        if (brokerEmail) {
            // 🔒 अगर ईमेल है, तो सिर्फ उस ब्रोकर की प्रॉपर्टी (डैशबोर्ड के लिए)
            properties = await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() });
        } else {
            // 🌐 अगर ईमेल नहीं है, तो सारी प्रॉपर्टीज दिखाओ (मेन पेज के लिए)
            properties = await Property.find();
        }
        res.json(properties);
    } catch (error) {
        res.status(500).json({ message: 'डेटा लाने में गड़बड़ हुई' });
    }
});