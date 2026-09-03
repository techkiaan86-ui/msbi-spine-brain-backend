const axios = require('axios');

async function testNormalization() {
  const url = 'https://msbi-spine-brain-backend-production.up.railway.app/api/v1/webhooks/wordpress/forms';
  const secret = 'testsecret123'; // Matches .env WORDPRESS_FORM_WEBHOOK_SECRET

  const basePayload = {
    formId: '1023',
    formName: 'Request Appointment',
    firstName: 'NormTest',
    lastName: 'Integration',
    email: 'norm-test@example.com',
    phone: '555-0000',
    metadata: {
      hadMRI: 'No',
      howDidYouHearAboutUs: 'Normalization Test'
    }
  };

  const cases = [
    { name: 'Phone, Email', method: 'Phone, Email', id: 'norm-test-1' },
    { name: 'Phone', method: 'Phone', id: 'norm-test-2' },
    { name: 'Email', method: 'Email', id: 'norm-test-3' },
  ];

  for (const c of cases) {
    try {
      const payload = {
        ...basePayload,
        submissionId: c.id,
        metadata: {
          ...basePayload.metadata,
          preferredContactMethod: c.method
        }
      };
      console.log(`\nTesting ${c.name}...`);
      const res = await axios.post(url, payload, {
        headers: { 'x-webhook-secret': secret }
      });
      console.log(`Status: ${res.status}`);
      console.log(`Saved Contact Method:`, JSON.stringify(res.data.data.metadata.preferredContactMethod));
    } catch (err) {
      if (err.response) {
        console.error(`Error Status: ${err.response.status}`);
        console.error(`Error Data:`, JSON.stringify(err.response.data));
      } else {
        console.error(`Error: ${err.message}`);
      }
    }
  }
}

testNormalization();
