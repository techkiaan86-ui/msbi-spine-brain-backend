const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log("Starting WordPress Share Your Experience Webhook local test...");

  // 1. Fetch a clinic and provider from the database to test relationship binding
  const clinic = await prisma.clinic.findFirst();
  const provider = await prisma.provider.findFirst();

  console.log(`Using clinic: ${clinic ? clinic.name : 'None (No clinics in DB)'} [ID: ${clinic ? clinic.id : 'N/A'}]`);
  console.log(`Using provider: ${provider ? provider.name : 'None (No providers in DB)'} [ID: ${provider ? provider.id : 'N/A'}]`);

  const secret = process.env.WORDPRESS_FORM_WEBHOOK_SECRET || 'testsecret123';
  
  // 2. Prepare payload (testing "Yes" / "No" string inputs to ensure coercion works)
  const payload = {
    firstName: "Test",
    lastName: "Patient",
    email: "test@example.com",
    phone: "1234567890",
    comment: "Test Share Your Experience review",
    providerAnsweredQuestions: "Yes",
    providerExplainedClearly: "Yes",
    staffHelpful: "Yes",
    wouldRecommend: "Yes",
    clinicId: "",
    providerId: ""
  };

  const url = 'http://127.0.0.1:8000/api/v1/reputation/reviews';

  try {
    console.log("Sending POST request to:", url);
    const res = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': secret
      }
    });

    console.log("✅ API responded with status:", res.status);
    console.log("Response data:", JSON.stringify(res.data, null, 2));

    if (res.data.success) {
      console.log("\nReview successfully created in the Database.");
      console.log(`Calculated star rating: ${res.data.data.rating} ★ (Expected: 5 ★)`);
      console.log(`Matched Provider ID: ${res.data.data.providerId || 'None'}`);
      console.log(`Matched Clinic ID: ${res.data.data.clinicId || 'None'}`);
    } else {
      console.error("❌ API returned failure response");
    }

  } catch (err) {
    console.error("❌ Webhook test failed:", err.response ? err.response.data : err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
