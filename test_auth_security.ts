import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';

async function runAuthSecurityTests() {
  console.log('====================================================');
  console.log('  STARTING STEP 2: BACKEND AUTHENTICATION SECURITY TESTS');
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
    // 1. Fetch standard admin user from the database or first active admin
    let realUser = await prisma.user.findUnique({
      where: { email: 'admin@msbi.com' },
      include: { role: true, department: true }
    });

    if (!realUser) {
      realUser = await prisma.user.findFirst({
        where: { roleName: 'Admin', isActive: true },
        include: { role: true, department: true }
      });
    }

    if (!realUser) {
      throw new Error('No active user found in database for testing.');
    }

    console.log(`[TEST SETUP] Using real database user: ${realUser.email} (ID: ${realUser.id}, Role: ${realUser.roleName})\n`);

    // Generate tokens for test cases
    const validToken = jwt.sign(
      { userId: realUser.id, email: realUser.email, role: realUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const expiredToken = jwt.sign(
      { userId: realUser.id, email: realUser.email, role: realUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '-10s' } // Expired 10 seconds ago
    );

    const wrongSecretToken = jwt.sign(
      { userId: realUser.id, email: realUser.email, role: realUser.roleName },
      'wrong-secret-key-12345678901234567890',
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const nonExistentUserToken = jwt.sign(
      { userId: '00000000-0000-0000-0000-000000000000', email: 'ghost@msbi.com' },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const forgedRoleToken = jwt.sign(
      { userId: realUser.id, email: realUser.email, role: 'SuperAdminForgedClientRole' },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    // -------------------------------------------------------------
    // TEST GROUP 1: Token Validation & Boundary Cases
    // -------------------------------------------------------------
    console.log('--- TEST GROUP 1: Token Validation & Rejection ---');

    // 1.1 Missing Token on Protected Route (/api/v1/auth/me)
    const resMissing = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me'
    });
    assert(resMissing.statusCode === 401, 'Protected /auth/me returns 401 on missing Authorization header');

    // 1.2 Malformed Authorization Header (Not Bearer)
    const resMalformedHeader = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Basic dXNlcjpwYXNz' }
    });
    assert(resMalformedHeader.statusCode === 401, 'Protected /auth/me returns 401 on non-Bearer Authorization header');

    // 1.3 Malformed JWT string
    const resMalformedToken = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer invalid.jwt.string' }
    });
    assert(resMalformedToken.statusCode === 401, 'Protected /auth/me returns 401 on malformed JWT');

    // 1.4 Expired Token
    const resExpired = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${expiredToken}` }
    });
    assert(resExpired.statusCode === 401, 'Protected /auth/me returns 401 on expired token', resExpired.body);

    // 1.5 Invalid Signature (Signed with wrong secret)
    const resWrongSig = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${wrongSecretToken}` }
    });
    assert(resWrongSig.statusCode === 401, 'Protected /auth/me returns 401 on invalid JWT signature');

    // 1.6 Non-Existent Database User in Valid Token
    const resGhost = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${nonExistentUserToken}` }
    });
    assert(resGhost.statusCode === 401, 'Protected /auth/me returns 401 when token user ID does not exist in DB');

    // -------------------------------------------------------------
    // TEST GROUP 2: Authenticated User Loading & Context
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Authoritative Database User Context ---');

    // 2.1 Valid Token on /auth/me returns authoritative user data
    const resValidMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${validToken}` }
    });
    const meBody = JSON.parse(resValidMe.body);
    assert(
      resValidMe.statusCode === 200 && meBody.success === true && meBody.data.id === realUser.id,
      'Valid token returns 200 and loads real database user profile',
      resValidMe.body
    );

    // 2.2 Role verification: Server must load authoritative role from DB, never trust client token claim
    const resForgedRole = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${forgedRoleToken}` }
    });
    const forgedBody = JSON.parse(resForgedRole.body);
    assert(
      resForgedRole.statusCode === 200 && forgedBody.data.roleName === realUser.roleName && forgedBody.data.roleName !== 'SuperAdminForgedClientRole',
      'Server ignores forged client role in token and loads authoritative DB role'
    );

    // -------------------------------------------------------------
    // TEST GROUP 3: Protection Across All Domain Endpoints
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Domain Endpoints Access Control ---');

    const protectedEndpoints = [
      { method: 'GET', url: '/api/v1/users', name: 'User Management' },
      { method: 'GET', url: '/api/v1/roles', name: 'RBAC Roles' },
      { method: 'GET', url: '/api/v1/dashboard/summary', name: 'Dashboard' },
      { method: 'GET', url: '/api/v1/campaigns', name: 'Campaigns' },
      { method: 'GET', url: '/api/v1/budget/overview', name: 'Budget' },
      { method: 'GET', url: '/api/v1/vendors', name: 'Vendors' },
      { method: 'GET', url: '/api/v1/analytics/overview', name: 'Marketing Analytics' },
      { method: 'GET', url: '/api/v1/reputation/reviews', name: 'Reputation Reviews' },
      { method: 'GET', url: '/api/v1/settings/organization', name: 'Settings' },
      { method: 'GET', url: '/api/v1/reports/exports', name: 'Reports' },
      { method: 'GET', url: '/api/v1/integrations/status', name: 'Integrations' },
      { method: 'GET', url: '/api/v1/leads', name: 'Patient Leads' },
      { method: 'GET', url: '/api/v1/calls', name: 'Call Tracking' },
      { method: 'GET', url: '/api/v1/form-submissions', name: 'Form Submissions' }
    ];

    for (const ep of protectedEndpoints) {
      // Unauthenticated call -> Must be 401
      const resUnauth = await app.inject({
        method: ep.method as any,
        url: ep.url
      });
      assert(resUnauth.statusCode === 401, `Unauthenticated ${ep.name} (${ep.url}) returns 401 Unauthorized`);

      // Authenticated call -> Must be 200
      const resAuth = await app.inject({
        method: ep.method as any,
        url: ep.url,
        headers: { authorization: `Bearer ${validToken}` }
      });
      assert(resAuth.statusCode === 200, `Authenticated ${ep.name} (${ep.url}) returns 200 OK`);
    }

    // -------------------------------------------------------------
    // TEST GROUP 4: Public Endpoints (Intentionally Open)
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Public Endpoints Verification ---');

    // 4.1 Health Check is Public
    const resHealth = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    assert(resHealth.statusCode === 200, 'Health check (/api/health) is intentionally public (200)');

    // 4.2 Login endpoint is Public
    const resLoginInvalid = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nonexistent@msbi.com', password: 'wrongpassword' }
    });
    assert(resLoginInvalid.statusCode === 401, 'Login endpoint (/api/v1/auth/login) is public and rejects invalid credentials with 401');

    // 4.3 Google OAuth Callback is Public
    const resOAuthCallback = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/google/oauth/callback'
    });
    // Missing code or state returns 400, confirming route is publicly reached
    assert(resOAuthCallback.statusCode === 400, 'Google OAuth callback (/api/v1/integrations/google/oauth/callback) is public');

    // -------------------------------------------------------------
    // TEST GROUP 5: Login Functionality with Real User
    // -------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Real User Login Verification ---');

    // Test real login
    const resRealLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: realUser.email, password: 'password123' }
    });

    const loginBody = JSON.parse(resRealLogin.body);
    assert(
      resRealLogin.statusCode === 200 && loginBody.success === true && !!loginBody.data?.token,
      `Real database user login (${realUser.email}) successful with valid token generated`,
      resRealLogin.body
    );

    // Verify the generated token works on /me
    const resVerify = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${loginBody.data?.token || ''}` }
    });
    assert(resVerify.statusCode === 200, 'Token from real login immediately authenticates on /api/v1/auth/me', resVerify.body);

  } catch (error: any) {
    console.error('Test execution error:', error);
    failed++;
  } finally {
    await app.close();
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`  AUTHENTICATION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthSecurityTests();
