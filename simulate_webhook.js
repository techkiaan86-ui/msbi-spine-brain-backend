const axios = require('axios');
const crypto = require('crypto');

// This script simulates a real patient submitting a form on midwestspine.net
async function simulateWordPressWebhook() {
  console.log("Simulating a patient form submission from midwestspine.net...");
  
  // The secret that would be configured in WordPress and .env
  const secret = process.env.WORDPRESS_FORM_WEBHOOK_SECRET || 'test_secret_123';
  
  const payload = {
    formId: "cf7_101",
    formName: "Consultation Request Form",
    submissionId: "sub_" + Date.now(),
    firstName: "Rahul",
    lastName: "Sharma",
    email: "rahul.sharma@example.com",
    phone: "9876543210",
    message: "I am experiencing lower back pain for 2 weeks. Need a consultation.",
    sourceUrl: "https://midwestspine.net/contact/",
    landingPage: "https://midwestspine.net/",
    submittedAt: new Date().toISOString()
  };

  try {
    const apiUrl = process.env.API_URL || 'https://msbi-spine-brain-backend-production.up.railway.app';
    const response = await axios.post(`${apiUrl}/api/v1/webhooks/wordpress/forms`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret
      }
    });
    
    console.log("✅ Success! Webhook Logic is Fully Connected.");
    console.log("CRM Backend Response:", response.data);
    console.log("\n-> The data has been saved to the database.");
    console.log("-> You can now check the Frontend (Marketing Analytics / Leads) to see this data live!");
  } catch (error) {
    console.error("❌ Error:", error.response ? error.response.data : error.message);
  }
}

simulateWordPressWebhook();
