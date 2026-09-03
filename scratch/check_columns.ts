import prisma from '../src/plugins/db';

async function checkSchema() {
  const columns: any = await prisma.$queryRawUnsafe(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'activitylog' OR TABLE_NAME = 'ActivityLog';
  `);
  console.log('Columns in DB:', columns);
  await prisma.$disconnect();
}

checkSchema().catch(console.error);
