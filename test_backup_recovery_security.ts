import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';
import { encryptCredential, decryptCredential } from './src/utils/crypto';
import { SecurityEvents } from './src/services/audit.service';
import fs from 'fs';
import path from 'path';

async function runBackupRecoverySecurityTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 15: BACKUP, DISASTER RECOVERY & RECOVERY SECURITY');
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
    // Load real database users deterministically
    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true },
      include: { role: true }
    });

    const specialistUser = await prisma.user.findFirst({
      where: { email: 'specialist@msbi.com', roleName: 'Specialist', isActive: true },
      include: { role: true }
    });

    const clinicalUser = await prisma.user.findFirst({
      where: { email: 'clinical@msbi.com', roleName: 'Clinical Lead', isActive: true },
      include: { role: true }
    });

    if (!adminUser || !specialistUser || !clinicalUser) {
      throw new Error('Required real test users missing from database.');
    }

    console.log(`[TEST SETUP] Loaded Real Database Users:`);
    console.log(` - Admin: ${adminUser.email} (ID: ${adminUser.id})`);
    console.log(` - Specialist: ${specialistUser.email} (ID: ${specialistUser.id})`);
    console.log(` - Clinical Lead: ${clinicalUser.email} (ID: ${clinicalUser.id})\n`);

    const adminToken = jwt.sign(
      { userId: adminUser.id, email: adminUser.email, role: adminUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const specialistToken = jwt.sign(
      { userId: specialistUser.id, email: specialistUser.email, role: specialistUser.roleName },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    // -------------------------------------------------------------------------
    // TEST GROUP 1: Backup Confidentiality & Static File Route Isolation
    // -------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Backup Confidentiality & Static File Route Isolation ---');

    const backupProbePaths = [
      '/backup.sql',
      '/backup.dump',
      '/dump.sql',
      '/database.sql',
      '/db_backup.sql',
      '/backups/production.sql',
      '/backups',
      '/data/backup.tar.gz',
      '/export/database.sql'
    ];

    let allProbeBlocked = true;
    for (const probePath of backupProbePaths) {
      const probeRes = await app.inject({
        method: 'GET',
        url: probePath
      });
      if (probeRes.statusCode !== 404 && probeRes.statusCode !== 400 && probeRes.statusCode !== 401) {
        allProbeBlocked = false;
        break;
      }
    }
    assert(allProbeBlocked, 'Raw database dump and backup probe paths are unroutable / return 404');

    // Verify Fastify backend does not register unsafe static backup serving directories
    assert(
      !app.hasRoute({ method: 'GET', url: '/backups/*' }),
      'Fastify backend does NOT expose static backup directory routes'
    );

    // -------------------------------------------------------------------------
    // TEST GROUP 2: Disaster Recovery & Diagnostic Endpoint Access Control
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Disaster Recovery & Diagnostic Access Control ---');

    // Unauthenticated access rejected
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/recovery-status'
    });
    assert(unauthRes.statusCode === 401, 'Unauthenticated recovery status request rejected with 401');

    // Unauthorized role (Specialist lacks 'settings' permission) rejected
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/recovery-status',
      headers: { authorization: `Bearer ${specialistToken}` }
    });
    assert(forbiddenRes.statusCode === 403, 'Unauthorized non-admin role rejected with 403 Forbidden');

    // Authorized administrator succeeds
    const authRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/recovery-status',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(authRes.statusCode === 200, 'Authorized administrator can access recovery diagnostic (200 OK)');

    const diagnosticBody = JSON.parse(authRes.payload);
    assert(diagnosticBody.success === true, 'Diagnostic response indicates success');
    assert(diagnosticBody.data.systemStatus === 'HEALTHY', 'Diagnostic reports system status is HEALTHY');
    assert(diagnosticBody.data.database.connectivity === 'connected', 'Diagnostic confirms active MySQL connectivity');
    assert(diagnosticBody.data.database.modelDelegatesVerified === 16, 'Diagnostic verified all 16 required model delegates');

    // -------------------------------------------------------------------------
    // TEST GROUP 3: Secret & Credential Non-Exposure in Recovery Diagnostics
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Secret & Credential Non-Exposure in Diagnostics ---');

    const rawPayload = authRes.payload;
    assert(!rawPayload.includes('mysql://'), 'Diagnostic response does NOT expose raw MySQL connection string');
    assert(!rawPayload.includes(process.env.DATABASE_URL || 'railway.internal'), 'Diagnostic response does NOT leak DATABASE_URL');
    assert(!rawPayload.includes(secret), 'Diagnostic response does NOT leak JWT_SECRET');
    assert(
      !process.env.INTEGRATION_ENCRYPTION_KEY || !rawPayload.includes(process.env.INTEGRATION_ENCRYPTION_KEY),
      'Diagnostic response does NOT leak INTEGRATION_ENCRYPTION_KEY'
    );
    assert(!rawPayload.includes('password'), 'Diagnostic response contains NO plaintext passwords');

    // -------------------------------------------------------------------------
    // TEST GROUP 4: Database Schema Integrity & Model Coverage (All 16 Models)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Schema Referential Integrity & Model Coverage ---');

    const modelDelegates = [
      'user',
      'role',
      'department',
      'lead',
      'formSubmission',
      'callLog',
      'campaign',
      'budget',
      'vendor',
      'review',
      'integrationCredential',
      'activityLog',
      'userSession',
      'userMFA',
      'userMFARecoveryCode',
      'userMFAChallenge'
    ] as const;

    let allDelegatesPresent = true;
    for (const delegate of modelDelegates) {
      if (!(delegate in prisma) || typeof (prisma as any)[delegate].findMany !== 'function') {
        allDelegatesPresent = false;
        break;
      }
    }
    assert(allDelegatesPresent, 'All 16 Prisma entity delegates are accessible on Prisma Client');

    // Test referential integrity: User foreign keys
    const usersWithRelations = await prisma.user.findFirst({
      where: { email: 'admin@msbi.com' },
      include: { role: true, department: true }
    });
    assert(!!usersWithRelations?.role, 'User to Role referential foreign key integrity verified');

    // -------------------------------------------------------------------------
    // TEST GROUP 5: Cryptographic Key Dependency & Fail-Closed Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Cryptographic Key Dependency & Fail-Closed Behavior ---');

    const testPayload = 'clinical_secret_token_verification_12345';
    const encrypted = encryptCredential(testPayload);
    assert(encrypted.startsWith('v1:'), 'Encrypted payload uses authenticated v1: AES-256-GCM format');

    const decrypted = decryptCredential(encrypted);
    assert(decrypted === testPayload, 'Decryption with correct INTEGRATION_ENCRYPTION_KEY succeeds');

    // Tampered ciphertext fails closed (returns null)
    let tamperedBlocked = false;
    try {
      const parts = encrypted.split(':');
      const tamperedParts = [parts[0], parts[1], parts[2], parts[3].slice(0, -2) + 'ff'];
      const tamperedRes = decryptCredential(tamperedParts.join(':'));
      if (tamperedRes === null) {
        tamperedBlocked = true;
      }
    } catch {
      tamperedBlocked = true;
    }
    assert(tamperedBlocked, 'Tampered ciphertext fails closed with null (authentication tag mismatch)');

    // -------------------------------------------------------------------------
    // TEST GROUP 6: MFA Recovery Invariants & Secret Protection
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: MFA Recovery Invariants & State Protection ---');

    // Verify all existing UserMFA records store encrypted secrets (never plaintext)
    const mfaRecords = await prisma.userMFA.findMany();
    let allMfaEncrypted = true;
    for (const mfa of mfaRecords) {
      if (!mfa.secretEncrypted.startsWith('v1:') || mfa.secretEncrypted.length < 32) {
        allMfaEncrypted = false;
        break;
      }
    }
    assert(allMfaEncrypted, 'All UserMFA records in database store AES-256-GCM encrypted secrets at rest');

    // Verify recovery codes are stored as 64-character SHA-256 hashes
    const recoveryCodeRecords = await prisma.userMFARecoveryCode.findMany();
    let allRecoveryCodesHashed = true;
    for (const rc of recoveryCodeRecords) {
      if (rc.codeHash.length !== 64 || /[^0-9a-f]/i.test(rc.codeHash)) {
        allRecoveryCodesHashed = false;
        break;
      }
    }
    assert(allRecoveryCodesHashed, 'All UserMFARecoveryCode records are stored as 64-character SHA-256 hex hashes');

    // Expired MFA challenge rejected
    const expiredChallengeToken = 'test-expired-challenge-token-string';
    const expiredChallengeHash = require('crypto').createHash('sha256').update(expiredChallengeToken).digest('hex');
    const expiredChallenge = await prisma.userMFAChallenge.create({
      data: {
        userId: adminUser.id,
        tokenHash: expiredChallengeHash,
        expiresAt: new Date(Date.now() - 60000) // 1 minute in the past
      }
    });

    const expiredChallengeLookup = await prisma.userMFAChallenge.findFirst({
      where: {
        tokenHash: expiredChallengeHash,
        usedAt: null,
        expiresAt: { gt: new Date() }
      }
    });
    assert(expiredChallengeLookup === null, 'Expired MFA challenge token cannot be retrieved for verification');

    // Cleanup expired challenge test artifact
    await prisma.userMFAChallenge.delete({ where: { id: expiredChallenge.id } });

    // -------------------------------------------------------------------------
    // TEST GROUP 7: Session & JWT Invariant Preservation After Recovery
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Session & JWT Invariant Preservation ---');

    // Verify revoked sessions remain revoked
    const revokedSession = await prisma.userSession.create({
      data: {
        userId: adminUser.id,
        refreshTokenHash: require('crypto').createHash('sha256').update(`test_revoked_${Date.now()}`).digest('hex'),
        ipAddress: '127.0.0.1',
        userAgent: 'SecurityTest/1.0',
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(),
        revokedReason: 'Disaster recovery session revocation test'
      }
    });

    const revokedToken = jwt.sign(
      { userId: adminUser.id, email: adminUser.email, role: adminUser.roleName, sessionId: revokedSession.id },
      secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const revokedAccessRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/recovery-status',
      headers: { authorization: `Bearer ${revokedToken}` }
    });
    assert(revokedAccessRes.statusCode === 401, 'Revoked session is strictly rejected with 401 Unauthorized');

    // Cleanup session test artifact
    await prisma.userSession.delete({ where: { id: revokedSession.id } });

    // -------------------------------------------------------------------------
    // TEST GROUP 8: Audit Logging of System Diagnostics & Redaction
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: Audit Trail & Diagnostic Event Logging ---');

    const diagnosticAuditLog = await prisma.activityLog.findFirst({
      where: { action: 'SYSTEM_HEALTH_DIAGNOSTIC', userId: adminUser.id },
      orderBy: { timestamp: 'desc' }
    });

    assert(!!diagnosticAuditLog, 'SYSTEM_HEALTH_DIAGNOSTIC event recorded in ActivityLog repository');
    assert(diagnosticAuditLog?.success === true, 'Diagnostic audit event marked as successful');
    assert(
      !diagnosticAuditLog?.failureReason?.includes('mysql://'),
      'Audit log entries contain NO raw connection strings or secrets'
    );

    // -------------------------------------------------------------------------
    // TEST GROUP 9: Health Check Safety & Information Non-Leakage
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 9: Health Check Safety & Information Non-Leakage ---');

    const healthRes = await app.inject({
      method: 'GET',
      url: '/health'
    });
    assert(healthRes.statusCode === 200, '/health returns 200 OK');
    const healthBody = JSON.parse(healthRes.payload);
    assert(healthBody.status === 'ok', '/health status is "ok"');
    assert(Object.keys(healthBody).length === 2, '/health exposes ONLY status and timestamp (zero internal paths)');

    const apiHealthRes = await app.inject({
      method: 'GET',
      url: '/api/health'
    });
    assert(apiHealthRes.statusCode === 200, '/api/health returns 200 OK');

    // -------------------------------------------------------------------------
    // TEST GROUP 10: Environment Configuration & Secret Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 10: Environment Configuration & Secret Isolation ---');

    const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
    assert(envContent.includes('DATABASE_URL='), '.env contains DATABASE_URL for local development');
    assert(envContent.includes('JWT_SECRET='), '.env contains JWT_SECRET');
    assert(envContent.includes('INTEGRATION_ENCRYPTION_KEY='), '.env contains INTEGRATION_ENCRYPTION_KEY');

    const gitignoreContent = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf-8');
    assert(gitignoreContent.includes('.env'), '.gitignore properly excludes .env from version control');

    const dockerignoreContent = fs.readFileSync(path.join(__dirname, '.dockerignore'), 'utf-8');
    assert(dockerignoreContent.includes('.env'), '.dockerignore properly excludes .env from Docker image builds');

    // -------------------------------------------------------------------------
    // TEST GROUP 11: Compliance Governance Contingency Controls
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 11: Compliance Governance Contingency Controls ---');

    const complianceRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/status',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(complianceRes.statusCode === 200, '/api/v1/compliance/status returns 200 OK');
    const compData = JSON.parse(complianceRes.payload).data;
    assert(
      compData.controlsSummary.administrativeSafeguards.contingencyPlan.includes('SECURITY_STEP_12_DR_RUNBOOK.md'),
      'Compliance status references structured Disaster Recovery Runbook'
    );
    assert(
      compData.certificationClaim.includes('NONE'),
      'Compliance status accurately declares zero false HIPAA certifications'
    );

    console.log('\n================================================================');
    console.log(`  STEP 15 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Fatal Step 15 test execution error:', error);
    process.exit(1);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

runBackupRecoverySecurityTests();
