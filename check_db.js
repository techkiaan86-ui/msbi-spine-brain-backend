const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking database tables ---');
  
  const credentials = await prisma.integrationCredential.findMany({
    select: { platformName: true, isActive: true, lastSyncAt: true, lastSuccessfulSyncAt: true, lastError: true, config: true }
  });
  console.log('Credentials status:');
  console.log(JSON.stringify(credentials, null, 2));

  const clinics = await prisma.clinic.findMany({
    select: { id: true, name: true, googleLocationId: true }
  });
  console.log('Clinics:', clinics);

  const reviews = await prisma.review.findMany();
  console.log(`Reviews count: ${reviews.length}`);
  if (reviews.length > 0) {
    console.log('Sample Review:', reviews[0]);
  }

  const campaigns = await prisma.campaign.findMany();
  console.log(`Campaigns count: ${campaigns.length}`);
  if (campaigns.length > 0) {
    console.log('Sample Campaign:', campaigns[0]);
  }

  const snapshots = await prisma.campaignMetricSnapshot.findMany();
  console.log(`Campaign Metric Snapshots count: ${snapshots.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
