import prisma from '../src/plugins/db';

async function main() {
  const count = await prisma.activityLog.count();
  const sample = await prisma.activityLog.findMany({
    take: 5,
    orderBy: { timestamp: 'desc' },
    include: { user: true }
  });
  console.log('ActivityLog total count:', count);
  console.log('Sample rows:', JSON.stringify(sample, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);
