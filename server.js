// 🎯 प्राइवेसी + पब्लिक व्यू दोनों के लिए बिल्कुल फुल-प्रूफ प्रॉपर्टी गेट रूट
app.get('/api/get-properties', async (req, res) => {
    try {
        const brokerEmail = req.query.email;
        let properties = [];
        
        // 🛡️ चेक करें कि ईमेल सच में मौजूद है, खाली नहीं है, और "undefined" टेक्स्ट नहीं है
        if (brokerEmail && brokerEmail.trim() !== "" && brokerEmail !== "undefined") {
            // 🔒 अगर वैलिड ईमेल है, तो सिर्फ उस ब्रोकर की प्रॉपर्टी (डैशबोर्ड के लिए)
            properties = await Property.find({ brokerEmail: brokerEmail.toLowerCase().trim() });
        } else {
            // 🌐 अगर ईमेल नहीं है या खाली है, तो बिना किसी फिल्टर के सारी प्रॉपर्टीज दिखाओ (मेन पेज के लिए)
            properties = await Property.find();
        }
        
        res.json(properties);
    } catch (error) {
        console.error("डेटाबेस फेच एरर:", error);
        res.status(500).json({ message: 'डेटा लाने में गड़बड़ हुई' });
    }
});