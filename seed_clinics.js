const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Seeding Clinics and Providers ---');
  
  const clinics = [
    { name: 'Roseville Clinic', address: 'Roseville, MN', phone: '651-555-0101' },
    { name: 'Stillwater Clinic', address: 'Stillwater, MN', phone: '651-555-0102' },
    { name: 'Woodbury Clinic', address: 'Woodbury, MN', phone: '651-555-0103' }
  ];

  for (const c of clinics) {
    const existing = await prisma.clinic.findFirst({ where: { name: c.name } });
    if (!existing) {
      const created = await prisma.clinic.create({ data: c });
      console.log(`Created clinic: ${created.name}`);
      
      // Create a provider for each clinic
      const providerName = c.name.replace(' Clinic', ' Specialist');
      await prisma.provider.create({
        data: {
          name: `Dr. ${providerName}`,
          specialty: 'Spine Surgery',
          clinicId: created.id
        }
      });
      console.log(`Created provider for ${created.name}`);
    } else {
      console.log(`Clinic already exists: ${c.name}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
