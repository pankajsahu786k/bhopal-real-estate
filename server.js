<script>
        document.getElementById('uploadBtn').addEventListener('click', async function() {
            // सही तरीके से वैल्यूज निकालना
            const title = document.getElementById('title').value;
            const purpose = document.getElementById('purpose').value;
            const location = document.getElementById('location').value;
            const price = document.getElementById('price').value;
            const desc = document.getElementById('desc').value;
            const imageInput = document.getElementById('propertyImage');

            // अगर कोई भी फ़ील्ड या इमेज खाली है तो यहीं रोक देना
            if (!title || !purpose || !location || !price || !desc || imageInput.files.length === 0) {
                alert("कृपया सभी जानकारियां भरें और प्रॉपर्टी की फोटो अवश्य चुनें!");
                return;
            }

            // 💡 फोटो और डेटा भेजने के लिए FormData का पैकेट तैयार करना
            const formData = new FormData();
            formData.append('title', title);
            formData.append('purpose', purpose);
            formData.append('location', location);
            formData.append('price', price);
            formData.append('desc', desc);
            formData.append('propertyImage', imageInput.files[0]);

            // 🎯 प्राइवेसी के लिए सबसे ज़रूरी लाइन: ब्राउज़र की तिजोरी से लॉग इन यूजर का ईमेल निकालकर पैकेट में जोड़ना
            const savedEmail = localStorage.getItem('brokerEmail') || '';
            formData.append('brokerEmail', savedEmail.toLowerCase().trim()); // ईमेल को पूरी तरह साफ करके भेजें

            try {
                // सर्वर को डेटा भेजना
                const response = await fetch('/api/add-property', {
                    method: 'POST',
                    body: formData // FormData भेजते समय Headers में Content-Type नहीं लिखा जाता
                });

                const result = await response.json();

                if (result.success) {
                    alert(result.message);
                    window.location.href = 'dashboard.html'; // वापस डैशबोर्ड पर ले जाएँ
                } else {
                    alert(result.message || 'कुछ गड़बड़ हो गई, कृपया दोबारा कोशिश करें।');
                }
            } catch (error) {
                console.error("अपलोड एरर:", error);
                alert('सर्वर से संपर्क नहीं हो पाया।');
            }
        });
    </script>