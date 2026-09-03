import prisma from '../src/plugins/db';

async function checkFk() {
  const fks: any = await prisma.$queryRawUnsafe(`
    SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE (TABLE_NAME = 'activitylog' OR TABLE_NAME = 'ActivityLog') AND REFERENCED_TABLE_NAME IS NOT NULL;
  `);
  console.log('Foreign keys:', fks);
  await prisma.$disconnect();
}

checkFk().catch(console.error);
