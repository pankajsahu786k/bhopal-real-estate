const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// 🌐 Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 📁 स्टैटिक फाइल्स और अपलोड किए गए फोटोज का रास्ता सेट करें
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 🗄️ MongoDB Connection (Render Environment Variable या लोकल दोनों के लिए)
const mongoURI = process.env.MONGO_URI || "your_mongodb_connection_string_here"; 
mongoose.connect(mongoURI)
    .then(() => console.log('🎯 मोंगोडीबी (MongoDB) की तिजोरी सफलतापूर्वक