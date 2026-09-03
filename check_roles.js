const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking Roles and Permissions in Database ---');
  const roles = await prisma.role.findMany();
  console.log(JSON.stringify(roles, null, 2));

  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true, roleName: true, isActive: true }
  });
  console.log('Users in database:', users);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
