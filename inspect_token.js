const { PrismaClient } = require('@prisma/client');
const { decryptCredential } = require('./dist/utils/crypto');
const { googleOAuthService } = require('./dist/services/google.service');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Inspecting Token Scopes ---');
  const cred = await prisma.integrationCredential.findUnique({
    where: { platformName: 'google-business' }
  });

  if (!cred) {
    console.log('❌ No google-business credential found');
    return;
  }

  const accessToken = decryptCredential(cred.accessToken);
  const refreshToken = decryptCredential(cred.refreshToken);
  const config = cred.config;

  console.log('Refreshing token to get a fresh access token...');
  try {
    const { client } = await googleOAuthService.getAuthenticatedClient(accessToken, refreshToken, config?.expiryDate);
    const tokenRes = await client.getAccessToken();
    const freshToken = tokenRes.token || client.credentials.access_token;
    
    console.log('Inspecting token with Google tokeninfo endpoint...');
    const infoRes = await axios.get(`https://oauth2.googleapis.com/tokeninfo?access_token=${freshToken}`);
    console.log('Token Info:', JSON.stringify(infoRes.data, null, 2));
  } catch (err) {
    console.error('❌ Failed:', err.response?.data || err.message);
  }
}

main().finally(() => prisma.$disconnect());
