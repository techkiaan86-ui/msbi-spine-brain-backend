const dotenv = require('dotenv');
dotenv.config();

const { googleBusinessService } = require('./dist/services/google-business.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Calling Google Business Service Live ---');
  try {
    const accounts = await googleBusinessService.getAccessibleAccounts();
    console.log('✅ Accounts fetched successfully:');
    console.log(JSON.stringify(accounts, null, 2));

    if (accounts.length > 0) {
      const accountId = accounts[0].accountId;
      console.log(`\nFetching locations for account: ${accountId}...`);
      const locations = await googleBusinessService.getAccessibleLocations(accountId);
      console.log('✅ Locations fetched successfully:');
      console.log(JSON.stringify(locations, null, 2));
    }
  } catch (err) {
    console.error('❌ Failed live test:', err.message);
  }
}

main().finally(() => prisma.$disconnect());
