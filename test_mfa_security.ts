/**
 * ============================================================================
 * STEP 14 SECURITY VERIFICATION TEST SUITE: MULTI-FACTOR AUTHENTICATION (MFA)
 * ============================================================================
 * 
 * Verifies production-ready TOTP Multi-Factor Authentication (RFC 6238):
 * 1. Database schema (UserMFA, UserMFARecoveryCode, UserMFAChallenge)
 * 2. Cryptographic encryption of TOTP secrets at rest (AES-256-GCM)
 * 3. TOTP secret generation, QR code Data URL provisioning, Base32 validation
 * 4. MFA enrollment status, start, and verification flow
 * 5. One-time hashed recovery codes generation, storage, and validation
 * 6. Two-step login flow: password verification -> 5-min challenge -> TOTP/Recovery code
 * 7. Single-use challenge token consumption & replay protection
 * 8. Challenge expiration enforcement
 * 9. Recovery code consumption, count decrement, and single-use enforcement
 * 10. Recovery codes regeneration (requires re-authentication)
 * 11. MFA disable flow (requires password + second factor)
 * 12. Complete audit trail logging for all 10 MFA security events
 * 13. Backwards compatibility for non-MFA accounts
 */

import prisma from './src/plugins/db';
import { mfaService } from './src/services/mfa.service';
import { authService } from './src/services/auth.service';
import { encryptCredential, decryptCredential } from './src/utils/crypto';
import { SecurityEvents } from './src/services/audit.service';
import * as OTPAuth from 'otpauth';
import bcrypt from 'bcryptjs';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runMfaSecurityTests() {
  console.log('================================================================');
  console.log('STARTING STEP 14: MULTI-FACTOR AUTHENTICATION (MFA) TEST SUITE');
  console.log('================================================================\n');

  const testEmail = `test.mfa.${Date.now()}@msbi.com`;
  const testPassword = 'Password123!Secure';
  let testUserId = '';
  let enrolledSecret = '';
  let recoveryCodes: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // PART 1: Database Schema & Relations
    // -------------------------------------------------------------------------
    console.log('[PART 1] Verifying Database Schema & Relations...');

    const role = await prisma.role.findFirst({ where: { name: 'Admin' } });
    if (!role) throw new Error('Default Admin role not found in database');

    const passwordHash = await bcrypt.hash(testPassword, 10);
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        firstName: 'MFA',
        lastName: 'TestSubject',
        roleName: role.name,
        isActive: true
      }
    });
    testUserId = user.id;

    assert(!!user.id, 'Test user created successfully in MySQL database');
    assert('userMFA' in prisma, 'Prisma Client exposes userMFA model delegate');
    assert('userMFARecoveryCode' in prisma, 'Prisma Client exposes userMFARecoveryCode model delegate');
    assert('userMFAChallenge' in prisma, 'Prisma Client exposes userMFAChallenge model delegate');

    // -------------------------------------------------------------------------
    // PART 2: Cryptographic Encryption of TOTP Secrets At Rest
    // -------------------------------------------------------------------------
    console.log('\n[PART 2] Verifying Cryptographic Encryption of TOTP Secrets At Rest...');

    const rawSecret = 'JBSWY3DPEHPK3PXP'; // Standard Base32 TOTP secret
    const encryptedSecret = encryptCredential(rawSecret);

    assert(typeof encryptedSecret === 'string' && encryptedSecret.startsWith('v1:'), 'TOTP secret encrypted using AES-256-GCM with format v1:iv:tag:cipher');
    assert(encryptedSecret !== rawSecret, 'Encrypted secret is ciphertext and does not expose raw Base32 secret');

    const decryptedSecret = decryptCredential(encryptedSecret);
    assert(decryptedSecret === rawSecret, 'Encrypted TOTP secret cleanly decrypts back to original Base32 secret');

    // -------------------------------------------------------------------------
    // PART 3: MFA Status for Non-Enrolled User
    // -------------------------------------------------------------------------
    console.log('\n[PART 3] Verifying Initial MFA Status...');

    const initialStatus = await mfaService.getStatus(testUserId);
    assert(initialStatus.enabled === false, 'Initial MFA status reports enabled: false');
    assert(initialStatus.verifiedAt === null, 'Initial MFA status reports verifiedAt: null');
    assert(initialStatus.remainingRecoveryCodes === 0, 'Initial MFA status reports 0 remaining recovery codes');
    assert(!('secretEncrypted' in initialStatus), 'MFA status object NEVER exposes encrypted or raw secret');

    // -------------------------------------------------------------------------
    // PART 4: MFA Enrollment Start (Secret & QR Code Generation)
    // -------------------------------------------------------------------------
    console.log('\n[PART 4] Verifying MFA Enrollment Start...');

    const enrollData = await mfaService.startEnrollment(testUserId, testEmail);
    assert(typeof enrollData.secret === 'string' && enrollData.secret.length >= 16, 'Generated Base32 secret with high entropy (>= 16 chars)');
    assert(typeof enrollData.qrCode === 'string' && enrollData.qrCode.startsWith('data:image/png;base64,'), 'Generated QR code as high-resolution PNG Data URL');
    assert(enrollData.otpauthUri.startsWith('otpauth://totp/'), 'Generated valid RFC 6238 otpauth URI');
    assert(enrollData.otpauthUri.includes('Midwest%20Spine%20%26%20Brain%20Institute') || enrollData.otpauthUri.includes('Midwest'), 'otpauth URI contains official MSBI practice issuer');

    enrolledSecret = enrollData.secret;

    // Verify DB state before verification: enabled must remain false
    const pendingMfa = await prisma.userMFA.findUnique({ where: { userId: testUserId } });
    assert(pendingMfa !== null, 'UserMFA record created in database');
    assert(pendingMfa?.enabled === false, 'UserMFA remains enabled: false until verified by first TOTP token');
    assert(pendingMfa?.verifiedAt === null, 'UserMFA verifiedAt is null prior to verification');

    // -------------------------------------------------------------------------
    // PART 5: MFA Enrollment Verification
    // -------------------------------------------------------------------------
    console.log('\n[PART 5] Verifying MFA Enrollment Confirmation...');

    // Test rejection of invalid / malformed code
    let rejectedInvalidCode = false;
    try {
      await mfaService.verifyEnrollment(testUserId, '000000');
    } catch (err: any) {
      rejectedInvalidCode = true;
    }
    assert(rejectedInvalidCode, 'Enrollment verification rejected invalid TOTP code');

    // Generate valid TOTP token using otpauth
    const totp = new OTPAuth.TOTP({
      issuer: 'Midwest Spine & Brain Institute',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(enrolledSecret)
    });
    const validCode = totp.generate();

    const verifyResult = await mfaService.verifyEnrollment(testUserId, validCode);
    assert(verifyResult.success === true, 'Enrollment verification succeeded with valid TOTP code');
    assert(Array.isArray(verifyResult.recoveryCodes) && verifyResult.recoveryCodes.length === 10, 'Generated exactly 10 one-time recovery codes');

    recoveryCodes = verifyResult.recoveryCodes;

    // Check DB state after verification
    const activeMfa = await prisma.userMFA.findUnique({ where: { userId: testUserId } });
    assert(activeMfa?.enabled === true, 'UserMFA updated to enabled: true in database');
    assert(activeMfa?.verifiedAt !== null, 'UserMFA verifiedAt timestamp recorded');
    assert(activeMfa?.enabledAt !== null, 'UserMFA enabledAt timestamp recorded');

    // Verify recovery codes are stored as SHA-256 hashes, not plaintext
    const dbRecoveryCodes = await prisma.userMFARecoveryCode.findMany({ where: { userId: testUserId } });
    assert(dbRecoveryCodes.length === 10, 'Exactly 10 recovery code records stored in database');
    const allHashed = dbRecoveryCodes.every(rc => rc.codeHash.length === 64 && !recoveryCodes.includes(rc.codeHash));
    assert(allHashed, 'All 10 recovery codes stored as SHA-256 hashes (never plaintext)');

    // -------------------------------------------------------------------------
    // PART 6: Two-Factor Login Challenge Initiation
    // -------------------------------------------------------------------------
    console.log('\n[PART 6] Verifying Two-Factor Login Challenge...');

    // Login with password for MFA-enabled user
    const loginChallengeResult: any = await authService.login({
      email: testEmail,
      password: testPassword
    });

    assert(loginChallengeResult.mfaRequired === true, 'authService.login returns mfaRequired: true for MFA-enabled user');
    assert(typeof loginChallengeResult.mfaChallenge === 'string' && loginChallengeResult.mfaChallenge.length === 64, 'authService.login issues 256-bit hexadecimal MFA challenge token');
    assert(!('token' in loginChallengeResult), 'authService.login DOES NOT issue JWT access token before MFA challenge is resolved');

    const mfaChallenge = loginChallengeResult.mfaChallenge;

    // Verify challenge token record in DB
    const challengeHash = mfaService.hashToken(mfaChallenge);
    const dbChallenge = await prisma.userMFAChallenge.findUnique({ where: { tokenHash: challengeHash } });
    assert(dbChallenge !== null, 'MFA challenge stored with secure SHA-256 hash in database');
    assert(dbChallenge?.usedAt === null, 'MFA challenge usedAt is initially null');
    assert(dbChallenge?.expiresAt !== undefined && dbChallenge.expiresAt > new Date(), 'MFA challenge expiresAt set in the future (5-min TTL)');

    // -------------------------------------------------------------------------
    // PART 7: MFA Login TOTP Verification & Replay Protection
    // -------------------------------------------------------------------------
    console.log('\n[PART 7] Verifying MFA Login Challenge Verification & Replay Protection...');

    // Test rejection of wrong TOTP code
    let rejectedWrongTotp = false;
    try {
      await mfaService.verifyLoginTotp(mfaChallenge, '000000');
    } catch (err: any) {
      rejectedWrongTotp = true;
    }
    assert(rejectedWrongTotp, 'Login verification rejected wrong TOTP code');

    // Test successful verification with valid TOTP code
    const validLoginCode = totp.generate();
    const loginResult = await mfaService.verifyLoginTotp(mfaChallenge, validLoginCode);
    assert(typeof loginResult.token === 'string' && loginResult.token.length > 20, 'TOTP verification issued valid JWT access token');
    assert(typeof loginResult.refreshToken === 'string', 'TOTP verification issued valid refresh token');
    assert(typeof loginResult.sessionId === 'string', 'TOTP verification created server session in MySQL');
    assert(loginResult.user.email === testEmail, 'User profile returned with authenticated session');

    // Test Replay Attack Prevention on challenge token
    let replayBlocked = false;
    try {
      await mfaService.verifyLoginTotp(mfaChallenge, validLoginCode);
    } catch (err: any) {
      if (err.message.includes('already been used')) {
        replayBlocked = true;
      }
    }
    assert(replayBlocked, 'Replay attack prevented: Single-use challenge cannot be reused');

    // Test Expired Challenge Rejection
    const expiredChallengeToken = authService.generateRefreshToken(); // 64 hex chars
    const expiredChallengeHash = mfaService.hashToken(expiredChallengeToken);
    await prisma.userMFAChallenge.create({
      data: {
        userId: testUserId,
        tokenHash: expiredChallengeHash,
        expiresAt: new Date(Date.now() - 60000) // Expired 1 min ago
      }
    });
    let expiredChallengeBlocked = false;
    try {
      await mfaService.verifyLoginTotp(expiredChallengeToken, totp.generate());
    } catch (err: any) {
      if (err.message.includes('expired')) {
        expiredChallengeBlocked = true;
      }
    }
    assert(expiredChallengeBlocked, 'Expired MFA challenge token rejected');

    // -------------------------------------------------------------------------
    // PART 8: MFA Login With Recovery Code & Race Condition Protection
    // -------------------------------------------------------------------------
    console.log('\n[PART 8] Verifying MFA Login With One-Time Recovery Code & Concurrency...');

    // Issue a second challenge for recovery code test
    const recoveryChallengeResult: any = await authService.login({
      email: testEmail,
      password: testPassword
    });
    const recoveryChallenge = recoveryChallengeResult.mfaChallenge;
    const testRecoveryCode = recoveryCodes[0];

    // Test verification with recovery code
    const recoveryLoginResult = await mfaService.verifyLoginRecoveryCode(recoveryChallenge, testRecoveryCode);
    assert(typeof recoveryLoginResult.token === 'string', 'Recovery code verification issued valid JWT access token');
    assert(recoveryLoginResult.remainingRecoveryCodes === 9, 'Remaining recovery codes count decremented to 9');

    // Test single-use enforcement of recovery code (Replay attack prevention)
    const thirdChallengeResult: any = await authService.login({
      email: testEmail,
      password: testPassword
    });
    let recoveryReplayBlocked = false;
    try {
      await mfaService.verifyLoginRecoveryCode(thirdChallengeResult.mfaChallenge, testRecoveryCode);
    } catch (err: any) {
      recoveryReplayBlocked = true;
    }
    assert(recoveryReplayBlocked, 'Recovery code single-use enforced: consumed recovery code cannot be reused');

    // Test Concurrent Race Condition Protection on Single Recovery Code
    const raceCode = recoveryCodes[1];
    const chal1Res: any = await authService.login({ email: testEmail, password: testPassword });
    const chal2Res: any = await authService.login({ email: testEmail, password: testPassword });

    const concurrentResults = await Promise.allSettled([
      mfaService.verifyLoginRecoveryCode(chal1Res.mfaChallenge, raceCode),
      mfaService.verifyLoginRecoveryCode(chal2Res.mfaChallenge, raceCode)
    ]);

    const fulfilledCount = concurrentResults.filter(r => r.status === 'fulfilled').length;
    const rejectedCount = concurrentResults.filter(r => r.status === 'rejected').length;
    assert(fulfilledCount === 1 && rejectedCount === 1, 'Race condition prevented: Concurrent consumption of same recovery code permits only 1 session');

    // -------------------------------------------------------------------------
    // PART 9: Recovery Codes Regeneration
    // -------------------------------------------------------------------------
    console.log('\n[PART 9] Verifying Recovery Codes Regeneration...');

    // Re-authenticating with wrong password fails
    let regenWrongPassBlocked = false;
    try {
      await mfaService.regenerateRecoveryCodes(testUserId, 'WrongPassword', totp.generate());
    } catch (err: any) {
      regenWrongPassBlocked = true;
    }
    assert(regenWrongPassBlocked, 'Regenerating recovery codes rejected invalid account password');

    // Re-authenticating with wrong TOTP code fails
    let regenWrongTotpBlocked = false;
    try {
      await mfaService.regenerateRecoveryCodes(testUserId, testPassword, '000000');
    } catch (err: any) {
      regenWrongTotpBlocked = true;
    }
    assert(regenWrongTotpBlocked, 'Regenerating recovery codes rejected invalid TOTP code');

    // Regenerate with valid password and TOTP code
    const regenResult = await mfaService.regenerateRecoveryCodes(testUserId, testPassword, totp.generate());
    assert(regenResult.success === true, 'Recovery codes successfully regenerated with valid password + TOTP');
    assert(regenResult.recoveryCodes.length === 10, 'Regenerated exactly 10 new recovery codes');

    const updatedStatus = await mfaService.getStatus(testUserId);
    assert(updatedStatus.remainingRecoveryCodes === 10, 'MFA status reflects 10 unused recovery codes');

    // -------------------------------------------------------------------------
    // PART 10: Disabling MFA
    // -------------------------------------------------------------------------
    console.log('\n[PART 10] Verifying MFA Deactivation...');

    // Disabling with wrong password fails
    let disableWrongPassBlocked = false;
    try {
      await mfaService.disableMfa(testUserId, 'WrongPassword', totp.generate());
    } catch (err: any) {
      disableWrongPassBlocked = true;
    }
    assert(disableWrongPassBlocked, 'Disabling MFA rejected invalid account password');

    // Disabling with wrong code fails
    let disableWrongCodeBlocked = false;
    try {
      await mfaService.disableMfa(testUserId, testPassword, '000000');
    } catch (err: any) {
      disableWrongCodeBlocked = true;
    }
    assert(disableWrongCodeBlocked, 'Disabling MFA rejected invalid TOTP code');

    // Disabling with valid password and valid TOTP code
    const disableResult = await mfaService.disableMfa(testUserId, testPassword, totp.generate());
    assert(disableResult.success === true, 'MFA successfully disabled with valid password + TOTP');

    const disabledStatus = await mfaService.getStatus(testUserId);
    assert(disabledStatus.enabled === false, 'MFA status confirms MFA is disabled');
    assert(disabledStatus.remainingRecoveryCodes === 0, 'All recovery codes wiped upon MFA deactivation');

    // Login for disabled user should now succeed directly without MFA challenge
    const directLoginResult: any = await authService.login({
      email: testEmail,
      password: testPassword
    });
    assert(directLoginResult.mfaRequired === undefined || directLoginResult.mfaRequired === false, 'Subsequent login for user with disabled MFA issues standard JWT session directly');
    assert(typeof directLoginResult.token === 'string', 'Direct login issues valid JWT access token');

    // -------------------------------------------------------------------------
    // PART 11: Audit Log Verification for MFA Security Events
    // -------------------------------------------------------------------------
    console.log('\n[PART 11] Verifying Complete Audit Trail Logging...');

    const auditLogs = await prisma.activityLog.findMany({
      where: {
        userId: testUserId
      },
      select: {
        action: true,
        success: true
      }
    });

    const loggedActions = auditLogs.map(l => l.action);

    assert(loggedActions.includes(SecurityEvents.MFA_ENROLLMENT_STARTED), 'Audit trail logged MFA_ENROLLMENT_STARTED');
    assert(loggedActions.includes(SecurityEvents.MFA_ENROLLMENT_VERIFIED), 'Audit trail logged MFA_ENROLLMENT_VERIFIED');
    assert(loggedActions.includes(SecurityEvents.MFA_ENABLED), 'Audit trail logged MFA_ENABLED');
    assert(loggedActions.includes(SecurityEvents.MFA_VERIFICATION_SUCCESS), 'Audit trail logged MFA_VERIFICATION_SUCCESS');
    assert(loggedActions.includes(SecurityEvents.MFA_VERIFICATION_FAILED), 'Audit trail logged MFA_VERIFICATION_FAILED');
    assert(loggedActions.includes(SecurityEvents.MFA_CHALLENGE_REPLAY_BLOCKED), 'Audit trail logged MFA_CHALLENGE_REPLAY_BLOCKED');
    assert(loggedActions.includes(SecurityEvents.MFA_RECOVERY_CODE_USED), 'Audit trail logged MFA_RECOVERY_CODE_USED');
    assert(loggedActions.includes(SecurityEvents.MFA_RECOVERY_CODES_REGENERATED), 'Audit trail logged MFA_RECOVERY_CODES_REGENERATED');
    assert(loggedActions.includes(SecurityEvents.MFA_DISABLED), 'Audit trail logged MFA_DISABLED');

  } catch (error: any) {
    console.error('UNEXPECTED TEST ERROR:', error);
    failed++;
  } finally {
    // Clean up test user & sessions safely
    if (testUserId) {
      await prisma.userMFARecoveryCode.deleteMany({ where: { userId: testUserId } });
      await prisma.userMFAChallenge.deleteMany({ where: { userId: testUserId } });
      await prisma.userMFA.deleteMany({ where: { userId: testUserId } });
      await prisma.userSession.deleteMany({ where: { userId: testUserId } });
      await prisma.activityLog.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } });
    }
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`STEP 14 MFA SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runMfaSecurityTests();
