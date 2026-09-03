const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { googleBusinessService } = require('./src/services/google-business.service');
const { callRailService } = require('./src/services/callrail.service');
const axios = require('axios');

jest = require('jest-mock');
axios.get = jest.fn();

async function run() {
  console.log("--- Starting Phase 4 Verification ---");
  
  // 1. Setup Mock Integration Credentials
  await prisma.integrationCredential.upsert({
    where: { platformName: 'google-business' },
    update: {
      isActive: true,
      accessToken: 'mock-gbp-token',
      config: { locationId: 'accounts/123/locations/456' }
    },
    create: {
      platformName: 'google-business',
      isActive: true,
      accessToken: 'mock-gbp-token',
      config: { locationId: 'accounts/123/locations/456' }
    }
  });

  await prisma.integrationCredential.upsert({
    where: { platformName: 'callrail' },
    update: {
      isActive: true,
      config: { accountId: 'mock-callrail-account' }
    },
    create: {
      platformName: 'callrail',
      isActive: true,
      config: { accountId: 'mock-callrail-account' }
    }
  });

  process.env.CALLRAIL_API_TOKEN = 'mock-callrail-api-token';

  // 2. Mock API responses
  axios.get.mockImplementation((url) => {
    if (url.includes('mybusiness.googleapis.com') && url.includes('reviews')) {
      return Promise.resolve({
        data: {
          reviews: [
            {
              reviewId: 'rev-001',
              starRating: 'FIVE',
              comment: 'Great doctor and staff.',
              createTime: new Date().toISOString(),
              reviewer: { displayName: 'John Doe' },
              reviewReply: { comment: 'Thank you!' }
            },
            {
              reviewId: 'rev-002',
              starRating: 'FOUR',
              comment: 'Good experience, but long wait.',
              createTime: new Date().toISOString(),
              reviewer: { displayName: 'Jane Smith' }
            }
          ]
        }
      });
    }
    
    if (url.includes('callrail.com') && url.includes('calls.json')) {
      return Promise.resolve({
        data: {
          calls: [
            {
              id: 9991,
              customer_name: 'Alice Johnson',
              customer_phone_number: '+16125550199',
              duration: 120, // seconds
              campaign: 'Google Ads Search',
              answered: true,
              customer_city: 'Minneapolis',
              recording_player_url: 'https://callrail.com/audio/9991',
              start_time: new Date().toISOString()
            },
            {
              id: 9992,
              customer_name: 'Bob Williams',
              customer_phone_number: '+16125550200',
              duration: 0,
              campaign: 'SEO Direct',
              answered: false,
              customer_city: 'St. Paul',
              start_time: new Date().toISOString()
            }
          ]
        }
      });
    }
    
    return Promise.reject(new Error('Unknown mock URL'));
  });

  try {
    // 3. Run GBP Sync
    console.log("\\nTesting GBP Review Sync...");
    const gbpResult = await googleBusinessService.syncReviews();
    console.log("GBP Sync Result:", gbpResult);
    
    // Check DB
    const reviews = await prisma.review.findMany({ where: { platform: 'Google' } });
    console.log(`Found ${reviews.length} Google Reviews in DB.`);
    console.log("Sample:", reviews[0]);
    if (reviews.length < 2) throw new Error("Expected at least 2 reviews to be synced.");
    
    // Ensure idempotency (run again)
    const gbpResult2 = await googleBusinessService.syncReviews();
    const reviews2 = await prisma.review.findMany({ where: { platform: 'Google' } });
    if (reviews2.length !== reviews.length) throw new Error("Duplicate reviews created on second sync!");
    console.log("GBP idempotency check passed.");

    // 4. Run CallRail Sync
    console.log("\\nTesting CallRail Sync...");
    const crResult = await callRailService.syncCalls();
    console.log("CallRail Sync Result:", crResult);
    
    // Check DB
    const calls = await prisma.callLog.findMany();
    console.log(`Found ${calls.length} Call Logs in DB.`);
    console.log("Sample:", calls[0]);
    if (calls.length < 2) throw new Error("Expected at least 2 calls to be synced.");
    if (typeof calls[0].duration !== 'string') throw new Error("CallLog duration must be a string.");
    
    // Ensure idempotency
    const crResult2 = await callRailService.syncCalls();
    const calls2 = await prisma.callLog.findMany();
    if (calls2.length !== calls.length) throw new Error("Duplicate calls created on second sync!");
    console.log("CallRail idempotency check passed.");
    
    console.log("\\n=== Phase 4 Verification Passed! ===");
  } catch (err) {
    console.error("Verification failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
