const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const sql = `
CREATE TABLE \`FormSubmission\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`externalSubmissionId\` VARCHAR(191) NOT NULL,
  \`leadId\` VARCHAR(191) NULL,
  \`formId\` VARCHAR(191) NULL,
  \`formName\` VARCHAR(191) NULL,
  \`name\` VARCHAR(191) NULL,
  \`email\` VARCHAR(191) NULL,
  \`phone\` VARCHAR(191) NULL,
  \`message\` TEXT NULL,
  \`landingPage\` VARCHAR(191) NULL,
  \`sourceUrl\` VARCHAR(191) NULL,
  \`utmSource\` VARCHAR(191) NULL,
  \`utmMedium\` VARCHAR(191) NULL,
  \`utmCampaign\` VARCHAR(191) NULL,
  \`utmTerm\` VARCHAR(191) NULL,
  \`utmContent\` VARCHAR(191) NULL,
  \`gclid\` VARCHAR(191) NULL,
  \`fbclid\` VARCHAR(191) NULL,
  \`submittedAt\` DATETIME(3) NULL,
  \`receivedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updatedAt\` DATETIME(3) NOT NULL,
  UNIQUE INDEX \`FormSubmission_externalSubmissionId_key\`(\`externalSubmissionId\`),
  PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE \`FormSubmission\` ADD CONSTRAINT \`FormSubmission_leadId_fkey\` FOREIGN KEY (\`leadId\`) REFERENCES \`Lead\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE;
  `;
  try {
    const commands = sql.split(';').filter(c => c.trim().length > 0);
    for (const cmd of commands) {
      await prisma.$executeRawUnsafe(cmd);
    }
    console.log("Migration applied!");
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
