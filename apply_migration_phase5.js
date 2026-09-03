const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'prisma/migrations/20240813000003_phase5_hubspot_mailchimp/migration.sql'), 'utf-8');
  const commands = sql.split(';').filter(cmd => cmd.trim() !== '');
  
  for (const cmd of commands) {
    try {
      console.log('Executing:', cmd.substring(0, 50) + '...');
      await prisma.$executeRawUnsafe(cmd);
      console.log('Success');
    } catch (e) {
      console.error('Failed:', e.message);
    }
  }
}
run().finally(() => prisma.$disconnect());
