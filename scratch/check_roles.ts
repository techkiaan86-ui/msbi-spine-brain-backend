import dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/plugins/db';

async function checkRoles() {
  const roles = await prisma.role.findMany();
  console.log('=== ROLES IN DATABASE ===');
  console.log(JSON.stringify(roles, null, 2));

  const users = await prisma.user.findMany({
    select: { id: true, email: true, roleName: true, isActive: true }
  });
  console.log('=== USERS IN DATABASE ===');
  console.log(JSON.stringify(users, null, 2));
}

checkRoles().finally(() => prisma.$disconnect());
