const { PrismaClient } = require('@prisma/client');
const { decryptCredential } = require('./dist/utils/crypto');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Testing Google APIs from Stored Credentials ---');

  for (const platform of ['google-business', 'google-ads']) {
    console.log(`\nChecking ${platform} credentials...`);
    const cred = await prisma.integrationCredential.findUnique({
      where: { platformName: platform }
    });

    if (!cred) {
      console.log(`❌ No credentials found for ${platform}`);
      continue;
    }

    console.log(`Credentials found (Active: ${cred.isActive})`);
    
    const accessToken = decryptCredential(cred.accessToken);
    const refreshToken = decryptCredential(cred.refreshToken);
    const config = cred.config;

    console.log(`Access Token present: ${!!accessToken}`);
    console.log(`Refresh Token present: ${!!refreshToken}`);
    console.log(`Config:`, JSON.stringify(config));

    if (!accessToken) {
      console.log(`❌ Access token is empty for ${platform}`);
      continue;
    }

    // Attempt to test with the access token
    if (platform === 'google-business') {
      try {
        console.log('Fetching GBP accounts...');
        const url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts`;
        const res = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        console.log(`✅ GBP accounts fetch success:`, res.data);
      } catch (err) {
        console.log(`❌ GBP accounts fetch failed with current access token:`, err.response?.data || err.message);
        
        // Attempt to refresh if refresh token is present
        if (refreshToken) {
          console.log('Attempting to refresh token using Google OAuth Service...');
          try {
            const { googleOAuthService } = require('./dist/services/google.service');
            const { client } = await googleOAuthService.getAuthenticatedClient(accessToken, refreshToken, config?.expiryDate);
            const tokenRes = await client.getAccessToken();
            console.log('Token refresh response received. New token retrieved successfully.');
          } catch (refErr) {
            console.log(`❌ Failed to refresh GBP token:`, refErr.message);
          }
        }
      }
    } else if (platform === 'google-ads') {
      try {
        const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || config?.customerId;
        const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        console.log(`Customer ID: ${customerId}`);
        console.log(`Developer Token present: ${!!developerToken}`);
        
        if (!customerId || !developerToken) {
          console.log(`❌ Customer ID or Developer Token missing for Google Ads`);
          continue;
        }

        const cleanCustomerId = customerId.replace(/-/g, '').trim();
        const url = `https://googleads.googleapis.com/v25/customers/${cleanCustomerId}`;
        
        const headers = {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': developerToken
        };
        const rawLoginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || config?.loginCustomerId;
        if (rawLoginCustomerId) {
          headers['login-customer-id'] = rawLoginCustomerId.replace(/-/g, '').trim();
        }

        console.log('Fetching Ads customer details...');
        const res = await axios.get(url, { headers });
        console.log(`✅ Ads customer fetch success:`, res.data);
      } catch (err) {
        console.log(`❌ Ads customer fetch failed with current access token:`, err.response?.data || err.message);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
