const { PrismaClient } = require('@prisma/client');
const { decryptCredential } = require('./dist/utils/crypto');
const { googleOAuthService } = require('./dist/services/google.service');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const cred = await prisma.integrationCredential.findUnique({
    where: { platformName: 'google-ads' }
  });

  const accessToken = decryptCredential(cred.accessToken);
  const refreshToken = decryptCredential(cred.refreshToken);
  const config = cred.config;

  const { client } = await googleOAuthService.getAuthenticatedClient(accessToken, refreshToken, config?.expiryDate);
  const tokenRes = await client.getAccessToken();
  const freshToken = tokenRes.token || client.credentials.access_token;
  
  console.log('Fresh Token Length:', freshToken?.length);
  console.log('Fresh Token Type:', typeof freshToken);

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const version = process.env.GOOGLE_ADS_API_VERSION || 'v25';
  const url = `https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`;

  try {
    const res = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${freshToken}`,
        'developer-token': developerToken
      }
    });
    console.log('Success:', res.data);
  } catch (err) {
    if (err.response) {
      console.log('Error Status:', err.response.status);
      console.log('Error Data:', JSON.stringify(err.response.data, null, 2));
      console.log('Error Headers:', err.response.headers);
    } else {
      console.log('Error Message:', err.message);
    }
  }
}

main().finally(() => prisma.$disconnect());
