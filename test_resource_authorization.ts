import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';

async function runResourceAuthTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 4: RESOURCE-LEVEL AUTHORIZATION & IDOR TESTS');
  console.log('================================================================\n');

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
    // 1. Fetch real database users
    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true }
    });

    const clinicalUser = await prisma.user.findFirst({
      where: { email: 'clinical@msbi.com', roleName: 'Clinical Lead', isActive: true }
    });

    const managerUser = await prisma.user.findFirst({
      where: { email: 'manager@msbi.com', roleName: 'Manager', isActive: true }
    });

    const specialistUser = await prisma.user.findFirst({
      where: { email: 'specialist@msbi.com', roleName: 'Specialist', isActive: true }
    });

    if (!adminUser || !clinicalUser || !managerUser || !specialistUser) {
      throw new Error('Required real test users missing from database.');
    }

    console.log(`[TEST SETUP] Loaded Real Database Users:`);
    console.log(` - Admin: ${adminUser.email} (ID: ${adminUser.id})`);
    console.log(` - Clinical Lead: ${clinicalUser.email} (ID: ${clinicalUser.id})`);
    console.log(` - Manager: ${managerUser.email} (ID: ${managerUser.id})`);
    console.log(` - Specialist: ${specialistUser.email} (ID: ${specialistUser.id})\n`);

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

    // Fetch a real campaign and form submission for testing
    const realCampaign = await prisma.campaign.findFirst({
      include: { owner: true }
    });

    const realFormSubmission = await prisma.formSubmission.findFirst();
    const realVendor = await prisma.vendor.findFirst();

    // -------------------------------------------------------------
    // TEST GROUP 1: User Notification Preferences IDOR Prevention
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 1: User Preferences IDOR Prevention ---');

    // 1.1 Clinical Lead tries to modify Manager's notification settings (Must return 403 Forbidden)
    const resIdorAttack = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${managerUser.id}/notifications`,
      headers: { authorization: `Bearer ${clinicalToken}` },
      payload: {
        phoneNumber: '+15559999999',
        emailAlerts: true,
        smsAlerts: true,
        alertLocations: ['Clinic A']
      }
    });
    assert(
      resIdorAttack.statusCode === 403,
      'IDOR Attack Blocked: User A cannot modify User B notification settings (returns 403 Forbidden)'
    );

    // 1.2 Specialist tries to modify Admin's notification settings (Must return 403 Forbidden)
    const resIdorAdminTarget = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${adminUser.id}/notifications`,
      headers: { authorization: `Bearer ${specialistToken}` },
      payload: {
        phoneNumber: '+15558888888',
        emailAlerts: false,
        smsAlerts: false
      }
    });
    assert(
      resIdorAdminTarget.statusCode === 403,
      'IDOR Attack Blocked: Non-admin cannot modify Admin notification settings (returns 403 Forbidden)'
    );

    // 1.3 Clinical Lead modifies their OWN notification settings (Must return 200 OK)
    const resOwnPrefs = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${clinicalUser.id}/notifications`,
      headers: { authorization: `Bearer ${clinicalToken}` },
      payload: {
        phoneNumber: '+15551234567',
        emailAlerts: true,
        smsAlerts: false,
        alertLocations: []
      }
    });
    assert(
      resOwnPrefs.statusCode === 200,
      'User can legitimately update their OWN notification settings (returns 200 OK)'
    );

    // 1.4 Admin modifies another user's notification settings (Must return 200 OK)
    const resAdminUpdateUser = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${managerUser.id}/notifications`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        phoneNumber: '+15557777777',
        emailAlerts: true,
        smsAlerts: true,
        alertLocations: []
      }
    });
    assert(
      resAdminUpdateUser.statusCode === 200,
      'Admin can administratively update user notification settings (returns 200 OK)'
    );

    // -------------------------------------------------------------
    // TEST GROUP 2: Manipulated & Non-Existent Resource IDs
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Manipulated & Non-Existent Resource IDs ---');

    const nonExistentUuid = 'a0000000-0000-4000-8000-000000000000';

    // 2.1 Non-existent Form Submission ID
    const resGhostForm = await app.inject({
      method: 'GET',
      url: `/api/v1/form-submissions/${nonExistentUuid}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(resGhostForm.statusCode === 404, 'Querying non-existent Form Submission returns 404 Not Found');

    // 2.2 Non-existent Campaign ID
    const resGhostCampaign = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${nonExistentUuid}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(resGhostCampaign.statusCode === 404, 'Querying non-existent Campaign returns 404 Not Found');

    // 2.3 Non-existent Vendor ID
    const resGhostVendor = await app.inject({
      method: 'GET',
      url: `/api/v1/vendors/${nonExistentUuid}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(resGhostVendor.statusCode === 404, 'Querying non-existent Vendor returns 404 Not Found');

    // 2.4 Non-existent Invoice ID on status update
    const resGhostInvoice = await app.inject({
      method: 'PUT',
      url: `/api/v1/vendors/invoices/${nonExistentUuid}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'Paid' }
    });
    assert(resGhostInvoice.statusCode === 404, 'Updating non-existent Invoice returns 404 Not Found');

    // 2.5 Non-existent Vendor contracts query
    const resGhostContracts = await app.inject({
      method: 'GET',
      url: `/api/v1/vendors/${nonExistentUuid}/contracts`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(resGhostContracts.statusCode === 404, 'Querying contracts of non-existent Vendor returns 404 Not Found');

    // -------------------------------------------------------------
    // TEST GROUP 3: Campaign Resource Authorization & Ownership
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Campaign Resource Authorization ---');

    if (realCampaign) {
      // 3.1 Admin can update campaign
      const resAdminCamp = await app.inject({
        method: 'PUT',
        url: `/api/v1/campaigns/${realCampaign.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'Active',
          budget: 5000
        }
      });
      assert(resAdminCamp.statusCode === 200, 'Admin can update any Campaign (returns 200 OK)');

      // 3.2 Manager can update campaign
      const resManagerCamp = await app.inject({
        method: 'PUT',
        url: `/api/v1/campaigns/${realCampaign.id}`,
        headers: { authorization: `Bearer ${managerToken}` },
        payload: {
          status: 'Active',
          budget: 6000
        }
      });
      assert(resManagerCamp.statusCode === 200, 'Manager can update Campaign (returns 200 OK)');

      // 3.3 Clinical Lead (who does not have campaigns permission) cannot update campaign
      const resClinicalCamp = await app.inject({
        method: 'PUT',
        url: `/api/v1/campaigns/${realCampaign.id}`,
        headers: { authorization: `Bearer ${clinicalToken}` },
        payload: {
          status: 'Draft',
          budget: 1000
        }
      });
      assert(resClinicalCamp.statusCode === 403, 'Unauthorized role cannot update Campaign (returns 403 Forbidden)');
    }

    // -------------------------------------------------------------
    // TEST GROUP 4: Form Submission & Patient Data Access Control
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Form Submission & Patient Data Access ---');

    if (realFormSubmission) {
      // 4.1 Authenticated user with analytics permission can read specific form submission
      const resFormAuth = await app.inject({
        method: 'GET',
        url: `/api/v1/form-submissions/${realFormSubmission.id}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });
      assert(resFormAuth.statusCode === 200, 'Authorized user can fetch Form Submission by ID (returns 200 OK)');

      // 4.2 Unauthenticated user cannot read specific form submission
      const resFormUnauth = await app.inject({
        method: 'GET',
        url: `/api/v1/form-submissions/${realFormSubmission.id}`
      });
      assert(resFormUnauth.statusCode === 401, 'Unauthenticated access to Form Submission returns 401 Unauthorized');
    }

    if (realVendor) {
      // 4.3 Authorized user with vendors permission can access vendor details
      const resVendorAuth = await app.inject({
        method: 'GET',
        url: `/api/v1/vendors/${realVendor.id}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });
      assert(resVendorAuth.statusCode === 200, 'Authorized user can access Vendor by ID (returns 200 OK)');

      // 4.4 Clinical Lead (no vendors permission) cannot access vendor details
      const resVendorNoPerm = await app.inject({
        method: 'GET',
        url: `/api/v1/vendors/${realVendor.id}`,
        headers: { authorization: `Bearer ${clinicalToken}` }
      });
      assert(resVendorNoPerm.statusCode === 403, 'User without vendors permission cannot access Vendor by ID (returns 403)');
    }

  } catch (error: any) {
    console.error('Resource Auth Test Execution Error:', error);
    failed++;
  } finally {
    await app.close();
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`  RESOURCE AUTH TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runResourceAuthTests();
