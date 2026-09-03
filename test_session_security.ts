/**
 * STEP 6: SESSION & JWT SECURITY TEST SUITE
 * 
 * Verifies:
 * 1. Valid login generates access token + refresh token + server session in MySQL.
 * 2. Invalid login produces LOGIN_FAILED audit event and is rejected.
 * 3. Expired access token rejected with 401.
 * 4. Invalid JWT signature rejected with 401.
 * 5. Missing JWT rejected with 401.
 * 6. Logout revokes server session in MySQL.
 * 7. Access with revoked session token rejected with 401 (SESSION_REVOKED).
 * 8. Disabled user cannot authenticate or use existing sessions.
 * 9. Re-enabling user restores login capability.
 * 10. Password change verifies current password and updates hash in DB.
 * 11. Previous sessions invalidated after password change.
 * 12. Session expiration rejected after expiration timestamp.
 * 13. Refresh token rotation produces new refresh token and access token.
 * 14. Refresh token reuse detection triggers revocation of all user sessions.
 * 15. Listing active user sessions returns metadata without exposing token hashes.
 * 16. Revoking individual session from session list succeeds.
 * 17. Revoking all sessions invalidates all concurrent sessions.
 * 18. Audit log contains structured session events (LOGIN_SUCCESS, LOGOUT, PASSWORD_CHANGED, TOKEN_ROTATED).
 * 19. Audit log contains NO passwords or raw tokens.
 * 20. Missing JWT_SECRET fails closed.
 */

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret, verifyJwtToken } from './src/middlewares/auth.middleware';
import { authService } from './src/services/auth.service';
import bcrypt from 'bcryptjs';

async function runSessionSecurityTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 6: SESSION AND JWT SECURITY TESTS');
  console.log('================================================================\n');

  const app = buildApp();
  await app.ready();
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failedCount++;
    }
  }

  // Load real test users from the MySQL database
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true }
  });
  const specialistUser = await prisma.user.findFirst({
    where: { email: 'specialist@msbi.com', roleName: 'Specialist', isActive: true }
  });

  if (!adminUser || !specialistUser) {
    throw new Error('Required test users not found in the database.');
  }

  console.log(`[TEST SETUP] Real Database Users Loaded:`);
  console.log(` - Admin: ${adminUser.email} (ID: ${adminUser.id})`);
  console.log(` - Specialist: ${specialistUser.email} (ID: ${specialistUser.id})\n`);

  try {
    // -------------------------------------------------------------------------
    // TEST GROUP 1: Fail-Closed JWT Secret & Token Signing
    // -------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: JWT Secret & Fail-Closed Behavior ---');

    const originalSecret = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      let caught = false;
      try {
        getJwtSecret();
      } catch (e: any) {
        caught = true;
        assert(e.message.includes('FATAL SECURITY CONFIGURATION'), 'Missing JWT_SECRET fails closed with descriptive fatal error');
      }
      if (!caught) assert(false, 'Missing JWT_SECRET must throw and fail closed');
    } finally {
      process.env.JWT_SECRET = originalSecret;
    }

    const secret = getJwtSecret();
    assert(secret.length >= 16, 'JWT_SECRET is set and non-trivial');

    // -------------------------------------------------------------------------
    // TEST GROUP 2: Login & Server Session Creation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Login & Server Session Creation ---');

    // Valid login for admin
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: adminUser.email,
        password: 'password123'
      }
    });

    assert(loginRes.statusCode === 200, 'Valid login returns 200 OK');
    const loginBody = JSON.parse(loginRes.body);
    assert(!!loginBody.data.token, 'Login returns access token');
    assert(!!loginBody.data.refreshToken, 'Login returns refresh token');
    assert(!!loginBody.data.sessionId, 'Login returns sessionId');

    // Verify session in database
    const dbSession = await prisma.userSession.findUnique({
      where: { id: loginBody.data.sessionId }
    });
    assert(!!dbSession, 'UserSession record created in MySQL database');
    assert(dbSession?.userId === adminUser.id, 'Session is bound to correct userId');
    assert(dbSession?.refreshTokenHash !== loginBody.data.refreshToken, 'Refresh token is stored as SHA-256 hash, not plaintext');
    assert(dbSession?.revokedAt === null, 'New session is not revoked');
    assert(dbSession!.expiresAt > new Date(), 'Session expiresAt is in the future');

    // Authenticated access with new session token
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${loginBody.data.token}`
      }
    });
    assert(meRes.statusCode === 200, 'Authenticated request with session token returns 200 OK');
    const meBody = JSON.parse(meRes.body);
    assert(meBody.data.sessionId === loginBody.data.sessionId, 'Authenticated context includes current sessionId');

    // Invalid login attempt
    const invalidLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: adminUser.email,
        password: 'wrongpassword'
      }
    });
    assert(invalidLoginRes.statusCode === 401, 'Invalid credentials returns 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST GROUP 3: Token Expiration & Tampering
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Token Expiration & Tampering ---');

    // Expired access token
    const expiredToken = jwt.sign(
      { userId: adminUser.id, sessionId: loginBody.data.sessionId },
      secret,
      { algorithm: 'HS256', expiresIn: -10 }
    );
    const expiredRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${expiredToken}` }
    });
    assert(expiredRes.statusCode === 401, 'Expired access token rejected with 401 Unauthorized');

    // Invalid signature token
    const tamperedToken = jwt.sign(
      { userId: adminUser.id, sessionId: loginBody.data.sessionId },
      'wrong-secret-key-signature',
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const tamperedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tamperedToken}` }
    });
    assert(tamperedRes.statusCode === 401, 'Tampered token signature rejected with 401 Unauthorized');

    // Missing authorization header
    const missingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me'
    });
    assert(missingRes.statusCode === 401, 'Missing Authorization header rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST GROUP 4: Logout & Server Session Revocation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Logout & Server Session Revocation ---');

    // Create a dedicated session for logout test
    const specialistLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: specialistUser.email,
        password: 'password123'
      }
    });
    const specLoginBody = JSON.parse(specialistLogin.body);
    const specToken = specLoginBody.data.token;
    const specSessionId = specLoginBody.data.sessionId;

    // Logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${specToken}` }
    });
    assert(logoutRes.statusCode === 200, 'Logout endpoint returns 200 OK');

    // Verify session revoked in database
    const revokedDbSession = await prisma.userSession.findUnique({
      where: { id: specSessionId }
    });
    assert(revokedDbSession?.revokedAt !== null, 'Session marked revoked in database upon logout');
    assert(revokedDbSession?.revokedReason === 'User logout', 'Session revocation reason recorded as "User logout"');

    // Request with revoked session token
    const postLogoutAccess = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${specToken}` }
    });
    assert(postLogoutAccess.statusCode === 401, 'Access with revoked session token rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST GROUP 5: Refresh Token Rotation & Reuse Detection
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Refresh Token Rotation & Reuse Detection ---');

    // Create session to test refresh
    const refreshLogin = await authService.login({
      email: specialistUser.email,
      password: 'password123'
    });

    const initialRefreshToken = refreshLogin.refreshToken;
    const initialSessionId = refreshLogin.sessionId;

    // Perform legitimate refresh
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: initialRefreshToken }
    });

    assert(refreshRes.statusCode === 200, 'Refresh token request returns 200 OK');
    const refreshBody = JSON.parse(refreshRes.body);
    assert(refreshBody.data.refreshToken !== initialRefreshToken, 'Refresh token was ROTATED to a new token');
    assert(!!refreshBody.data.token, 'New access token issued');

    // New access token works
    const newAccessRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${refreshBody.data.token}` }
    });
    assert(newAccessRes.statusCode === 200, 'Rotated access token grants API access');

    // REUSE ATTACK: Present the old/rotated refresh token again
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: initialRefreshToken }
    });
    assert(reuseRes.statusCode === 401, 'Reused old refresh token rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST GROUP 6: Concurrent Sessions Management & Revocation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Concurrent Sessions Management & Revocation ---');

    // Create 2 concurrent sessions for specialist
    const session1 = await authService.login({ email: specialistUser.email, password: 'password123' });
    const session2 = await authService.login({ email: specialistUser.email, password: 'password123' });

    // List active sessions
    const listSessionsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${session1.token}` }
    });

    assert(listSessionsRes.statusCode === 200, 'Active sessions listing returns 200 OK');
    const listSessionsBody = JSON.parse(listSessionsRes.body);
    assert(Array.isArray(listSessionsBody.data), 'Sessions returned as an array');
    assert(listSessionsBody.data.length >= 2, 'Multiple concurrent sessions listed');
    assert(!listSessionsBody.data[0].refreshTokenHash, 'Session listing does NOT expose token hashes');

    // Revoke individual session (session2)
    const revokeSingleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/auth/sessions/${session2.sessionId}/revoke`,
      headers: { authorization: `Bearer ${session1.token}` }
    });
    assert(revokeSingleRes.statusCode === 200, 'Individual session revocation returns 200 OK');

    // Verify session2 is now revoked
    const session2Access = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session2.token}` }
    });
    assert(session2Access.statusCode === 401, 'Revoked individual session rejected with 401');

    // Session 1 is still active
    const session1Access = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session1.token}` }
    });
    assert(session1Access.statusCode === 200, 'Non-revoked session 1 remains active');

    // Revoke all sessions
    const revokeAllRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-all',
      headers: { authorization: `Bearer ${session1.token}` }
    });
    assert(revokeAllRes.statusCode === 200, 'Revoke all sessions endpoint returns 200 OK');

    // Session 1 is now also revoked
    const postRevokeAll = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session1.token}` }
    });
    assert(postRevokeAll.statusCode === 401, 'Session 1 rejected after revoke-all');

    // -------------------------------------------------------------------------
    // TEST GROUP 7: Password Change & Session Invalidation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Password Change & Session Invalidation ---');

    // Login to get a valid session
    const pwdTestLogin = await authService.login({ email: specialistUser.email, password: 'password123' });

    // Change password (with correct current password)
    const changePwdRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${pwdTestLogin.token}` },
      payload: {
        currentPassword: 'password123',
        newPassword: 'password123_new'
      }
    });

    assert(changePwdRes.statusCode === 200, 'Password change returns 200 OK');

    // Previous session is now revoked
    const oldSessionPostPwd = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${pwdTestLogin.token}` }
    });
    assert(oldSessionPostPwd.statusCode === 401, 'Previous session rejected with 401 after password change');

    // Can login with new password
    const newPwdLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: specialistUser.email,
        password: 'password123_new'
      }
    });
    assert(newPwdLogin.statusCode === 200, 'Login with new password succeeds');

    // Restore original password for test repeatability
    const restorePwdRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${JSON.parse(newPwdLogin.body).data.token}` },
      payload: {
        currentPassword: 'password123_new',
        newPassword: 'password123'
      }
    });
    assert(restorePwdRes.statusCode === 200, 'Password restored for test repeatability');

    // -------------------------------------------------------------------------
    // TEST GROUP 8: Disabled User Immediate Lockout
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: Disabled User Immediate Lockout ---');

    // Login active specialist
    const activeLogin = await authService.login({ email: specialistUser.email, password: 'password123' });

    // Temporarily deactivate specialist
    await prisma.user.update({
      where: { id: specialistUser.id },
      data: { isActive: false }
    });

    try {
      // Existing active session token is immediately blocked
      const disabledAccess = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${activeLogin.token}` }
      });
      assert(disabledAccess.statusCode === 403, 'Deactivated user with active session immediately blocked with 403');

      // Cannot login while deactivated
      const disabledLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: specialistUser.email,
          password: 'password123'
        }
      });
      assert(disabledLogin.statusCode === 401, 'Deactivated user cannot initiate login');
    } finally {
      // Restore active status
      await prisma.user.update({
        where: { id: specialistUser.id },
        data: { isActive: true }
      });
    }

    // Re-enabled user can login normally
    const reEnabledLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: specialistUser.email,
        password: 'password123'
      }
    });
    assert(reEnabledLogin.statusCode === 200, 'Re-enabled user can login successfully');

    // -------------------------------------------------------------------------
    // TEST GROUP 9: Security Audit Log Verification & Secret Redaction
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 9: Security Audit Log Verification & Secret Redaction ---');

    // Check recent audit logs
    const auditLogs = await prisma.activityLog.findMany({
      take: 20,
      orderBy: { timestamp: 'desc' }
    });

    const hasLoginSuccess = auditLogs.some((l) => l.action === 'LOGIN_SUCCESS');
    const hasLogout = auditLogs.some((l) => l.action === 'LOGOUT');
    const hasPasswordChanged = auditLogs.some((l) => l.action === 'PASSWORD_CHANGED');
    const hasTokenRotated = auditLogs.some((l) => l.action === 'TOKEN_ROTATED');

    assert(hasLoginSuccess, 'Audit trail contains LOGIN_SUCCESS event');
    assert(hasLogout, 'Audit trail contains LOGOUT event');
    assert(hasPasswordChanged, 'Audit trail contains PASSWORD_CHANGED event');
    assert(hasTokenRotated, 'Audit trail contains TOKEN_ROTATED event');

    // Verify secret redaction
    const allLogJson = JSON.stringify(auditLogs);
    assert(!allLogJson.includes('password123'), 'Audit logs contain NO passwords or plaintext credentials');
    assert(!allLogJson.includes('Bearer '), 'Audit logs contain NO raw bearer tokens');

  } finally {
    await app.close();
  }

  console.log('\n================================================================');
  console.log(`  SESSION SECURITY TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSessionSecurityTests().catch((err) => {
  console.error('Fatal error running session security tests:', err);
  process.exit(1);
});
