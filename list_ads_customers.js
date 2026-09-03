const { PrismaClient } = require('@prisma/client');
const { decryptCredential } = require('./dist/utils/crypto');
const { googleOAuthService } = require('./dist/services/google.service');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Listing Accessible Google Ads Customers ---');
  const cred = await prisma.integrationCredential.findUnique({
    where: { platformName: 'google-ads' }
  });

  if (!cred) {
    console.log('❌ No google-ads credential found');
    return;
  }

  const accessToken = decryptCredential(cred.accessToken);
  const refreshToken = decryptCredential(cred.refreshToken);
  const config = cred.config;

  try {
    const { client } = await googleOAuthService.getAuthenticatedClient(accessToken, refreshToken, config?.expiryDate);
    const tokenRes = await client.getAccessToken();
    const freshToken = tokenRes.token || client.credentials.access_token;
    
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    console.log(`Developer Token present: ${!!developerToken}`);
    if (!developerToken || developerToken === 'mock-developer-token') {
      console.log('❌ No valid developer token in environment');
      return;
    }

    const version = process.env.GOOGLE_ADS_API_VERSION || 'v25';
    const url = `https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`;
    
    console.log(`Calling endpoint: ${url}`);
    const res = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${freshToken}`,
        'developer-token': developerToken
      }
    });
    console.log('✅ Accessible Customers:', JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('❌ Failed:', err.response?.data || err.message);
  }
}

main().finally(() => prisma.$disconnect());
