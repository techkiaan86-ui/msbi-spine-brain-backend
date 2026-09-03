import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';

async function runRbacSecurityTests() {
  console.log('====================================================');
  console.log('  STARTING STEP 3: BACKEND RBAC & AUTHORIZATION TESTS');
  console.log('====================================================\n');

  const app = buildApp();
  await app.ready();
  const secret = getJwtSecret();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `- ${detail}` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Fetch real database users for each role
    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true },
      include: { role: true }
    });

    const clinicalUser = await prisma.user.findFirst({
      where: { email: 'clinical@msbi.com', roleName: 'Clinical Lead', isActive: true },
      include: { role: true }
    });

    const managerUser = await prisma.user.findFirst({
      where: { email: 'manager@msbi.com', roleName: 'Manager', isActive: true },
      include: { role: true }
    });

    const specialistUser = await prisma.user.findFirst({
      where: { email: 'specialist@msbi.com', roleName: 'Specialist', isActive: true },
      include: { role: true }
    });

    if (!adminUser || !clinicalUser || !managerUser || !specialistUser) {
      throw new Error('Could not find all required real test roles in database.');
    }

    console.log(`[TEST SETUP] Real Database Users Loaded:`);
    console.log(` - Admin: ${adminUser.email} (Role: ${adminUser.roleName})`);
    console.log(` - Clinical Lead: ${clinicalUser.email} (Role: ${clinicalUser.roleName})`);
    console.log(` - Manager: ${managerUser.email} (Role: ${managerUser.roleName})`);
    console.log(` - Specialist: ${specialistUser.email} (Role: ${specialistUser.roleName})\n`);

    // Generate tokens
    const adminToken = jwt.sign(
      { userId: adminUser.id, email: adminUser.email, role: adminUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const clinicalToken = jwt.sign(
      { userId: clinicalUser.id, email: clinicalUser.email, role: clinicalUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const managerToken = jwt.sign(
      { userId: managerUser.id, email: managerUser.email, role: managerUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const specialistToken = jwt.sign(
      { userId: specialistUser.id, email: specialistUser.email, role: specialistUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    // Forged token: Clinical Lead user claiming "Admin" in client token payload
    const forgedAdminToken = jwt.sign(
      { userId: clinicalUser.id, email: clinicalUser.email, role: 'Admin' },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    // -------------------------------------------------------------
    // TEST GROUP 1: Role-Based Authorization Enforcement (Clinical Lead)
    // Clinical Lead permissions in DB:
    // dashboard: true, analytics: true, reputation: true, reports: true
    // budget: false, vendors: false, settings: false, campaigns: false, users-roles: false, integrations: false
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 1: Clinical Lead Access Enforcement ---');

    // 1.1 Authorized routes for Clinical Lead (Must return 200)
    const resClinicalDashboard = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalDashboard.statusCode === 200, 'Clinical Lead can access Dashboard summary (dashboard: true)');

    const resClinicalReports = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/exports',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalReports.statusCode === 200, 'Clinical Lead can access Reports (reports: true)');

    const resClinicalReviews = await app.inject({
      method: 'GET',
      url: '/api/v1/reputation/reviews',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalReviews.statusCode === 200, 'Clinical Lead can access Reputation reviews (reputation: true)');

    // 1.2 Restricted routes for Clinical Lead (Must return 403 Forbidden)
    const resClinicalUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalUsers.statusCode === 403, 'Clinical Lead CANNOT access Users & Roles (/api/v1/users -> 403)');

    const resClinicalBudget = await app.inject({
      method: 'GET',
      url: '/api/v1/budget/overview',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalBudget.statusCode === 403, 'Clinical Lead CANNOT access Budget (/api/v1/budget/overview -> 403)');

    const resClinicalVendors = await app.inject({
      method: 'GET',
      url: '/api/v1/vendors',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalVendors.statusCode === 403, 'Clinical Lead CANNOT access Vendors (/api/v1/vendors -> 403)');

    const resClinicalCampaigns = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalCampaigns.statusCode === 403, 'Clinical Lead CANNOT access Campaigns (/api/v1/campaigns -> 403)');

    const resClinicalSettings = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/organization',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalSettings.statusCode === 403, 'Clinical Lead CANNOT access Settings (/api/v1/settings/organization -> 403)');

    const resClinicalIntegrations = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/status',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(resClinicalIntegrations.statusCode === 403, 'Clinical Lead CANNOT access Integrations (/api/v1/integrations/status -> 403)');

    // -------------------------------------------------------------
    // TEST GROUP 2: Manager Role Permissions Verification
    // Manager permissions in DB:
    // campaigns: true, vendors: true, dashboard: true, analytics: true, reputation: true, reports: true
    // budget: false, settings: false, users-roles: false, integrations: false
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Manager Role Permissions Enforcement ---');

    const resManagerVendors = await app.inject({
      method: 'GET',
      url: '/api/v1/vendors',
      headers: { authorization: `Bearer ${managerToken}` }
    });
    assert(resManagerVendors.statusCode === 200, 'Manager CAN access Vendors (vendors: true -> 200)');

    const resManagerCampaigns = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns',
      headers: { authorization: `Bearer ${managerToken}` }
    });
    assert(resManagerCampaigns.statusCode === 200, 'Manager CAN access Campaigns (campaigns: true -> 200)');

    const resManagerBudget = await app.inject({
      method: 'GET',
      url: '/api/v1/budget/overview',
      headers: { authorization: `Bearer ${managerToken}` }
    });
    assert(resManagerBudget.statusCode === 403, 'Manager CANNOT access Budget (budget: false -> 403)');

    const resManagerUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${managerToken}` }
    });
    assert(resManagerUsers.statusCode === 403, 'Manager CANNOT access Users & Roles (users-roles: false -> 403)');

    const resManagerSettings = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/organization',
      headers: { authorization: `Bearer ${managerToken}` }
    });
    assert(resManagerSettings.statusCode === 403, 'Manager CANNOT access Settings (settings: false -> 403)');

    // -------------------------------------------------------------
    // TEST GROUP 3: Specialist Role Permissions Verification
    // Specialist permissions in DB:
    // campaigns: true, dashboard: true, analytics: true, reputation: true, reports: true
    // vendors: false, budget: false, settings: false, users-roles: false, integrations: false
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Specialist Role Permissions Enforcement ---');

    const resSpecialistCampaigns = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns',
      headers: { authorization: `Bearer ${specialistToken}` }
    });
    assert(resSpecialistCampaigns.statusCode === 200, 'Specialist CAN access Campaigns (campaigns: true -> 200)');

    const resSpecialistVendors = await app.inject({
      method: 'GET',
      url: '/api/v1/vendors',
      headers: { authorization: `Bearer ${specialistToken}` }
    });
    assert(resSpecialistVendors.statusCode === 403, 'Specialist CANNOT access Vendors (vendors: false -> 403)');

    // -------------------------------------------------------------
    // TEST GROUP 4: Admin Full Access (Super Role)
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Admin Full Access ---');

    const adminEndpoints = [
      { url: '/api/v1/users', name: 'Users' },
      { url: '/api/v1/roles', name: 'RBAC Roles' },
      { url: '/api/v1/budget/overview', name: 'Budget' },
      { url: '/api/v1/settings/organization', name: 'Settings' },
      { url: '/api/v1/integrations/status', name: 'Integrations' },
      { url: '/api/v1/vendors', name: 'Vendors' }
    ];

    for (const ep of adminEndpoints) {
      const resAdmin = await app.inject({
        method: 'GET',
        url: ep.url,
        headers: { authorization: `Bearer ${adminToken}` }
      });
      assert(resAdmin.statusCode === 200, `Admin has full access to ${ep.name} (${ep.url} -> 200)`);
    }

    // -------------------------------------------------------------
    // TEST GROUP 5: Anti-Privilege Escalation & Tampering
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Anti-Privilege Escalation & Tampering ---');

    // 5.1 Forged role claim in token: Client claims "role: Admin", but real DB user is Clinical Lead
    const resForgedUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${forgedAdminToken}` }
    });
    assert(
      resForgedUsers.statusCode === 403,
      'Tampered client token claiming "Admin" is rejected with 403 based on authoritative database role'
    );

    const resForgedBudget = await app.inject({
      method: 'GET',
      url: '/api/v1/budget/overview',
      headers: { authorization: `Bearer ${forgedAdminToken}` }
    });
    assert(
      resForgedBudget.statusCode === 403,
      'Tampered client token cannot bypass budget permissions (returns 403)'
    );

    // 5.2 System Role Deletion Protection
    const resDeleteSystemRole = await app.inject({
      method: 'DELETE',
      url: '/api/v1/roles/Admin',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(
      resDeleteSystemRole.statusCode === 403,
      'System roles (Admin) cannot be deleted (returns 403 Cannot delete system roles)'
    );

    // 5.3 Prevent deleting role with assigned active users
    const resDeleteAssignedRole = await app.inject({
      method: 'DELETE',
      url: '/api/v1/roles/Clinical%20Lead',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(
      resDeleteAssignedRole.statusCode === 403 || resDeleteAssignedRole.statusCode === 400,
      'Deleting role assigned to active users is rejected to prevent privilege escalation or orphans'
    );

  } catch (error: any) {
    console.error('RBAC Test Execution Error:', error);
    failed++;
  } finally {
    await app.close();
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`  RBAC SECURITY TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runRbacSecurityTests();
