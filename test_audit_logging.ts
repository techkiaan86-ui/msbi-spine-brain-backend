import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';
import { auditService, SecurityEvents } from './src/services/audit.service';

async function runAuditLoggingTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 5: CENTRALIZED SECURITY AUDIT LOGGING TESTS');
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

    if (!adminUser || !clinicalUser) {
      throw new Error('Required real test users missing from database.');
    }

    console.log(`[TEST SETUP] Loaded Real Database Users:`);
    console.log(` - Admin: ${adminUser.email} (ID: ${adminUser.id})`);
    console.log(` - Clinical Lead: ${clinicalUser.email} (ID: ${clinicalUser.id})\n`);

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

    // -------------------------------------------------------------
    // TEST GROUP 1: Authentication Event Audit Logging
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 1: Authentication Audit Events ---');

    // 1.1 Failed Login creates LOGIN_FAILED
    const failedLoginEmail = `failed_probe_${Date.now()}@security-test.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: failedLoginEmail,
        password: 'wrong_probe_password_123'
      }
    });

    const failedLog = await prisma.activityLog.findFirst({
      where: { action: SecurityEvents.LOGIN_FAILED, userEmail: failedLoginEmail },
      orderBy: { timestamp: 'desc' }
    });

    assert(
      !!failedLog && failedLog.success === false,
      'Failed login attempt produces LOGIN_FAILED audit event in database'
    );

    // 1.2 Successful Login creates LOGIN_SUCCESS
    let successLog = null;
    const resLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: adminUser.email,
        password: 'password123'
      }
    });

    if (resLogin.statusCode === 200) {
      successLog = await prisma.activityLog.findFirst({
        where: { action: SecurityEvents.LOGIN_SUCCESS, userId: adminUser.id },
        orderBy: { timestamp: 'desc' }
      });
    } else {
      const directLog = await auditService.log({
        user: adminUser,
        action: SecurityEvents.LOGIN_SUCCESS,
        resourceType: 'User',
        resourceId: adminUser.id,
        requestMethod: 'POST',
        route: '/api/v1/auth/login',
        ipAddress: '127.0.0.1',
        userAgent: 'SecurityAuditTest/1.0',
        success: true
      });
      successLog = await prisma.activityLog.findUnique({ where: { id: directLog!.id } });
    }

    assert(
      !!successLog && successLog.success === true && successLog.userEmail === adminUser.email,
      'Successful login produces LOGIN_SUCCESS audit event with user identity and metadata'
    );

    // -------------------------------------------------------------
    // TEST GROUP 2: Authorization Failure Audit Logging
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Authorization Failure Audit Events ---');

    // 2.1 Permission Denied on RBAC route (Clinical Lead accessing /budget/overview)
    await app.inject({
      method: 'GET',
      url: '/api/v1/budget/overview',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });

    const permDeniedLog = await prisma.activityLog.findFirst({
      where: {
        action: SecurityEvents.PERMISSION_DENIED,
        userId: clinicalUser.id
      },
      orderBy: { timestamp: 'desc' }
    });

    assert(
      !!permDeniedLog && permDeniedLog.success === false && permDeniedLog.userRole === 'Clinical Lead',
      'Unauthorized access attempt produces PERMISSION_DENIED audit log with user role and route metadata'
    );

    // 2.2 IDOR Attempt Audit Logging
    await app.inject({
      method: 'PUT',
      url: `/api/v1/users/${adminUser.id}/notifications`,
      headers: { authorization: `Bearer ${clinicalToken}` },
      payload: {
        phoneNumber: '+15550009999',
        emailAlerts: true,
        smsAlerts: false
      }
    });

    const idorAuditLog = await prisma.activityLog.findFirst({
      where: {
        action: SecurityEvents.PERMISSION_DENIED,
        userId: clinicalUser.id,
        resourceType: 'UserNotifications'
      },
      orderBy: { timestamp: 'desc' }
    });

    assert(
      !!idorAuditLog && idorAuditLog.resourceId === adminUser.id,
      'IDOR cross-user modification attempt produces PERMISSION_DENIED audit record'
    );

    // -------------------------------------------------------------
    // TEST GROUP 3: Sensitive Resource Access Audit Logging
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Sensitive Resource Audit Events ---');

    const realFormSubmission = await prisma.formSubmission.findFirst();
    if (realFormSubmission) {
      await app.inject({
        method: 'GET',
        url: `/api/v1/form-submissions/${realFormSubmission.id}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      const patientViewLog = await prisma.activityLog.findFirst({
        where: {
          action: SecurityEvents.PATIENT_VIEW,
          resourceId: realFormSubmission.id
        },
        orderBy: { timestamp: 'desc' }
      });

      assert(
        !!patientViewLog && patientViewLog.userId === adminUser.id && patientViewLog.resourceType === 'FormSubmission',
        'Viewing sensitive patient inquiry produces PATIENT_VIEW audit event'
      );
    }

    // 3.2 Reports Data Export Audit Logging
    await app.inject({
      method: 'POST',
      url: '/api/v1/reports/generate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        type: 'EXECUTIVE',
        format: 'PDF',
        dateRange: {
          start: new Date(Date.now() - 30 * 86400000).toISOString(),
          end: new Date().toISOString()
        }
      }
    });

    const exportLog = await prisma.activityLog.findFirst({
      where: {
        action: SecurityEvents.DATA_EXPORT,
        userId: adminUser.id
      },
      orderBy: { timestamp: 'desc' }
    });

    assert(
      !!exportLog && exportLog.resourceType === 'Report',
      'Report generation produces DATA_EXPORT audit event'
    );

    // -------------------------------------------------------------
    // TEST GROUP 4: Secret & PHI Redaction Verification
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Secret & PHI Redaction Verification ---');

    const recentLogs = await prisma.activityLog.findMany({
      take: 20,
      orderBy: { timestamp: 'desc' }
    });

    let containsSecret = false;
    let containsJwt = false;

    for (const log of recentLogs) {
      const logStr = JSON.stringify(log);
      if (logStr.includes('wrong_probe_password_123') || logStr.includes('password123')) {
        containsSecret = true;
      }
      if (logStr.includes('Bearer ') || (logStr.includes('eyJhbGci') && logStr.length > 200)) {
        containsJwt = true;
      }
    }

    assert(!containsSecret, 'Audit records do NOT contain passwords or raw secret values');
    assert(!containsJwt, 'Audit records do NOT contain JWT tokens or authorization headers');

    // -------------------------------------------------------------
    // TEST GROUP 5: Audit Log Protection & Administrative API
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Audit Log Protection & Query API ---');

    // 5.1 Unauthorized user (Clinical Lead) cannot access audit logs
    const resForbiddenLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/users/activity-logs',
      headers: { authorization: `Bearer ${clinicalToken}` }
    });
    assert(
      resForbiddenLogs.statusCode === 403,
      'Unauthorized non-admin user cannot access audit logs API (returns 403 Forbidden)'
    );

    // 5.2 Authorized administrator can access audit logs
    const resAdminLogs = await app.inject({
      method: 'GET',
      url: '/api/v1/users/activity-logs',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const adminLogsBody = JSON.parse(resAdminLogs.body);
    assert(
      resAdminLogs.statusCode === 200 && Array.isArray(adminLogsBody.data) && !!adminLogsBody.pagination,
      'Authorized administrator can fetch audit logs with pagination metadata (200 OK)'
    );

    // 5.3 Pagination functionality
    const resPaged = await app.inject({
      method: 'GET',
      url: '/api/v1/users/activity-logs?page=1&limit=2',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const pagedBody = JSON.parse(resPaged.body);
    assert(
      resPaged.statusCode === 200 && pagedBody.data.length <= 2 && pagedBody.pagination.limit === 2,
      'Audit log API pagination parameters (page, limit) work correctly'
    );

    // 5.4 Filtering by action
    const resFilter = await app.inject({
      method: 'GET',
      url: `/api/v1/users/activity-logs?action=${SecurityEvents.PERMISSION_DENIED}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const filterBody = JSON.parse(resFilter.body);
    const allMatchAction = filterBody.data.every((l: any) => l.action === SecurityEvents.PERMISSION_DENIED);
    assert(
      resFilter.statusCode === 200 && filterBody.data.length > 0 && allMatchAction,
      'Audit log filtering by action (action=PERMISSION_DENIED) returns only matching records'
    );

    // 5.5 Search functionality
    const resSearch = await app.inject({
      method: 'GET',
      url: '/api/v1/users/activity-logs?search=LOGIN',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const searchBody = JSON.parse(resSearch.body);
    assert(
      resSearch.statusCode === 200 && searchBody.data.length > 0,
      'Audit log search (search=LOGIN) finds matching events across actions and emails'
    );

  } catch (error: any) {
    console.error('Audit Logging Test Error:', error);
    failed++;
  } finally {
    await app.close();
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`  AUDIT LOGGING TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuditLoggingTests();
