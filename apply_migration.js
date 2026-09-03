const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE Review ADD COLUMN externalReviewId VARCHAR(191) NULL;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE CallLog ADD COLUMN externalCallId VARCHAR(191) NULL;`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX Review_platform_externalReviewId_key ON Review(platform, externalReviewId);`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX CallLog_externalCallId_key ON CallLog(externalCallId);`);
    console.log("Migration executed successfully!");
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}
run();
