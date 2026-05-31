<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Real Estate Website - Login/Signup</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>

    <div class="auth-container">
        <div class="login-form">
            <h2>लॉगिन करें</h2>
            <form id="loginForm">
                <input type="email" id="loginEmail" placeholder="E-Mail ID" required>
                <input type="password" id="loginPassword" placeholder="Password" required>
                <button type="submit">Login</button>
            </form>
        </div>

        <div class="signup-form">
            <h2>खाता बनाएँ</h2>
            <form id="signupForm">
                <input type="text" id="signupName" placeholder="Name" required>
                <input type="email" id="signupEmail" placeholder="E-Mail ID" required>
                <input type="password" id="signupPassword" placeholder="Password" required>
                <button type="submit">Register</button>
            </form>
        </div>
    </div>

    <script>
        // ======= १. लॉगिन का बिल्कुल सही जावास्क्रिप्ट लॉजिक =======
        document.getElementById('loginForm').addEventListener('submit', async function(event) {
            event.preventDefault(); // पेज को रीफ्रेश होने से रोकना
            
            const emailInput = document.getElementById('loginEmail').value;
            const passwordInput = document.getElementById('loginPassword').value;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: emailInput, password: passwordInput })
                });
                
                const result = await response.json();

                if (result.success) {
                    alert("लॉगिन सफल रहा!");
                    
                    // ब्राउज़र की तिजोरी में नाम और साफ किया हुआ ईमेल लॉक करना
                    localStorage.setItem('brokerName', result.name);
                    localStorage.setItem('brokerEmail', emailInput.toLowerCase().trim());
                    
                    // सीधे डैशबोर्ड पर ले जाना
                    window.location.href = 'dashboard.html';
                } else {
                    alert(result.message);
                }
            } catch (error) {
                console.error("लॉगिन एरर:", error);
                alert("सर्वर से संपर्क नहीं हो पाया या कोई तकनीकी समस्या है।"); // 💡 सुधार: ब्राउज़र के अनुकूल सही एरर मैसेज
            }
        });

        // ======= २. साइन-अप (रजिस्ट्रेशन) का जावास्क्रिप्ट लॉजिक =======
        document.getElementById('signupForm').addEventListener('submit', async function(event) {
            event.preventDefault();
            const name = document.getElementById('signupName').value;
            const email = document.getElementById('signupEmail').value;
            const password = document.getElementById('signupPassword').value;

            try {
                const response = await fetch('/api/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });
                const result = await response.json();
                alert(result.message);
                if (result.success) document.getElementById('signupForm').reset();
            } catch (error) {
                alert("अकाउंट बनाने में समस्या आई।");
            }
        });
    </script>
</body>
</html>