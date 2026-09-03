const fetch = require('node-fetch'); // or axios, wait, axios is in package.json
const axios = require('axios');

async function run() {
  const url = 'https://msbi-spine-brain-backend-production.up.railway.app/api/v1/webhooks/wordpress/forms';
  const secret = 'testsecret123';
  
  const payload1 = {
    submissionId: 'generate-one-safe-test-id-1234',
    formId: '1023',
    formName: 'Request Appointment',
    firstName: 'CRMTest',
    lastName: 'Integration',
    email: 'controlled-test-email@example.com',
    phone: 'safe-test-number',
    metadata: {
      hadMRI: 'No',
      preferredContactMethod: ['Email'],
      howDidYouHearAboutUs: 'CRM Integration Test'
    }
  };

  try {
    console.log('Sending first payload...');
    const res1 = await axios.post(url, payload1, {
      headers: { 'x-webhook-secret': secret }
    });
    console.log('Response 1 Status:', res1.status);
    console.log('Response 1 Data:', res1.data);
    
    console.log('Sending duplicate payload...');
    const res2 = await axios.post(url, payload1, {
      headers: { 'x-webhook-secret': secret }
    });
    console.log('Response 2 Status:', res2.status);
    console.log('Response 2 Data:', res2.data);
    
    console.log('Sending different submissionId payload...');
    const payload3 = { ...payload1, submissionId: 'generate-one-safe-test-id-1235' };
    const res3 = await axios.post(url, payload3, {
      headers: { 'x-webhook-secret': secret }
    });
    console.log('Response 3 Status:', res3.status);
    console.log('Response 3 Data:', res3.data);

  } catch (error) {
    if (error.response) {
      console.error('Error Status:', error.response.status);
      console.error('Error Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

run();
