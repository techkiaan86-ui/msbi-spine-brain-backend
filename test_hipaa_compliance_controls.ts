import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 13: HIPAA COMPLIANCE & GOVERNANCE TEST SUITE    ');
  console.log('================================================================\n');

  const app = buildApp();
  await app.ready();

  // Load real users from database
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true },
    include: { role: true }
  });
  const clinicalUser = await prisma.user.findFirst({
    where: { email: 'clinical@msbi.com', roleName: 'Clinical Lead', isActive: true },
    include: { role: true }
  });
  const specialistUser = await prisma.user.findFirst({
    where: { email: 'specialist@msbi.com', roleName: 'Specialist', isActive: true },
    include: { role: true }
  });
  const managerUser = await prisma.user.findFirst({
    where: { email: 'manager@msbi.com', roleName: 'Manager', isActive: true },
    include: { role: true }
  });

  if (!adminUser || !clinicalUser || !specialistUser || !managerUser) {
    throw new Error('Test prerequisite failed: Ensure Admin, Clinical Lead, Specialist, and Manager users exist in database.');
  }

  const jwtSecret = getJwtSecret();

  // Helper to generate access tokens
  const generateToken = (user: typeof adminUser) => {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.roleName },
      jwtSecret,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
  };

  const adminToken = generateToken(adminUser);
  const clinicalToken = generateToken(clinicalUser);
  const specialistToken = generateToken(specialistUser);
  const managerToken = generateToken(managerUser);

  // --- TEST GROUP 1: Unique User Identification (45 CFR § 164.312(a)(2)(i)) ---
  console.log('--- TEST GROUP 1: Unique User Identification (45 CFR § 164.312(a)(2)(i)) ---');
  {
    const users = await prisma.user.findMany({ select: { email: true } });
    const emails = users.map(u => u.email.toLowerCase());
    const uniqueEmails = new Set(emails);
    assert(emails.length === uniqueEmails.size, 'All workforce accounts have strictly unique email identifiers with zero duplicate shared accounts');

    // Verify duplicate registration attempt is rejected by unique constraint
    try {
      await prisma.user.create({
        data: {
          email: adminUser.email, // duplicate email
          passwordHash: 'dummyhash',
          firstName: 'Duplicate',
          lastName: 'User',
          roleName: 'Specialist'
        }
      });
      assert(false, 'Duplicate email creation should be rejected');
    } catch (err: any) {
      assert(err.code === 'P2002' || err.message.includes('Unique constraint'), 'Prisma schema enforces unique email constraint at the database layer');
    }
  }

  // --- TEST GROUP 2: Compliance Governance & Overview API Safety ---
  console.log('\n--- TEST GROUP 2: Compliance Governance & Overview API Safety ---');
  {
    // Unauthenticated access blocked
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/status'
    });
    assert(unauthRes.statusCode === 401, 'Unauthenticated access to compliance status returns 401 Unauthorized');

    // Non-admin without settings or users-roles permission blocked
    const specialistRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/status',
      headers: { authorization: `Bearer ${specialistToken}` }
    });
    assert(specialistRes.statusCode === 403, 'Specialist without settings/users-roles permission receives 403 Forbidden on compliance status');

    // Authorized Admin receives safe compliance status
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/status',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(adminRes.statusCode === 200, 'Authorized Administrator receives 200 OK for compliance status overview');

    const body = JSON.parse(adminRes.body);
    assert(body.success === true && body.data.governanceStatus === 'HIPAA-COMPLIANCE-READY', 'Compliance overview confirms HIPAA-COMPLIANCE-READY governance status');
    assert(body.data.certificationClaim.includes('NONE'), 'Compliance status explicitly declares zero false certification claims');
    
    // Check that response contains ZERO secrets, passwords, or connection strings
    const rawBodyStr = adminRes.body;
    assert(!rawBodyStr.includes('DATABASE_URL'), 'Compliance overview response contains no DATABASE_URL environment string');
    assert(!rawBodyStr.includes('JWT_SECRET'), 'Compliance overview response contains no JWT_SECRET');
    assert(!rawBodyStr.includes('INTEGRATION_ENCRYPTION_KEY'), 'Compliance overview response contains no encryption keys');
    assert(!rawBodyStr.includes('$2b$10$'), 'Compliance overview response contains zero bcrypt password hashes');
  }

  // --- TEST GROUP 3: Periodic Access Review Endpoint (45 CFR § 164.308(a)(4)) ---
  console.log('\n--- TEST GROUP 3: Periodic Access Review Endpoint (45 CFR § 164.308(a)(4)) ---');
  {
    // Unauthenticated access blocked
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/access-review'
    });
    assert(unauthRes.statusCode === 401, 'Unauthenticated access to access-review endpoint returns 401 Unauthorized');

    // Non-admin blocked
    const managerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/access-review',
      headers: { authorization: `Bearer ${managerToken}` }
    });
    assert(managerRes.statusCode === 403, 'Manager receives 403 Forbidden on access-review endpoint');

    // Authorized Admin receives user access snapshot
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/compliance/access-review',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(adminRes.statusCode === 200, 'Authorized Admin receives 200 OK on access-review snapshot');

    const body = JSON.parse(adminRes.body);
    assert(Array.isArray(body.data) && body.data.length >= 4, 'Access review returns active workforce inventory array');
    assert(body.data.every((u: any) => u.userId && u.email && u.role && typeof u.isActive === 'boolean'), 'Access review items contain structured identity, role, and active status fields');
    assert(!adminRes.body.includes('passwordHash'), 'Access review output strictly excludes password hashes');
  }

  // --- TEST GROUP 4: Compliance Action Audit Logging (45 CFR § 164.312(b)) ---
  console.log('\n--- TEST GROUP 4: Compliance Action Audit Logging (45 CFR § 164.312(b)) ---');
  {
    const latestLog = await prisma.activityLog.findFirst({
      where: {
        action: 'COMPLIANCE_STATUS_VIEWED',
        userId: adminUser.id
      },
      orderBy: { timestamp: 'desc' }
    });
    assert(latestLog !== null, 'Viewing compliance status generates COMPLIANCE_STATUS_VIEWED audit trail record');
    assert(latestLog?.resourceType === 'Compliance', 'Audit log records resourceType as Compliance');

    const accessReviewLog = await prisma.activityLog.findFirst({
      where: {
        action: 'ACCESS_REVIEW_AUDITED',
        userId: adminUser.id
      },
      orderBy: { timestamp: 'desc' }
    });
    assert(accessReviewLog !== null, 'Access review generation creates ACCESS_REVIEW_AUDITED audit log');
  }

  // --- TEST GROUP 5: Governance Policy Files & Versioning Validation ---
  console.log('\n--- TEST GROUP 5: Governance Policy Files & Versioning Validation ---');
  {
    const projectRoot = path.resolve(__dirname, '..');
    const policiesDir = path.join(projectRoot, 'compliance', 'policies');

    const expectedPolicies = [
      'HIPAA_SECURITY_POLICY.md',
      'PHI_HANDLING_POLICY.md',
      'ACCESS_CONTROL_POLICY.md',
      'PASSWORD_POLICY.md',
      'MFA_POLICY.md',
      'AUDIT_LOG_POLICY.md',
      'DATA_EXPORT_POLICY.md',
      'INCIDENT_RESPONSE_POLICY.md',
      'BACKUP_POLICY.md',
      'DISASTER_RECOVERY_POLICY.md',
      'VENDOR_MANAGEMENT_POLICY.md',
      'SECURITY_AWARENESS_POLICY.md',
      'WORKFORCE_SANCTIONS_POLICY.md',
      'ACCESS_REVIEW_POLICY.md',
      'DATA_RETENTION_POLICY.md'
    ];

    assert(fs.existsSync(policiesDir), 'Compliance policies directory (/compliance/policies/) exists');

    let allPoliciesValid = true;
    for (const policy of expectedPolicies) {
      const fullPath = path.join(policiesDir, policy);
      if (!fs.existsSync(fullPath)) {
        allPoliciesValid = false;
        break;
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('Policy ID') || !content.includes('Version') || !content.includes('Effective Date')) {
        allPoliciesValid = false;
        break;
      }
    }
    assert(allPoliciesValid, 'All 15 standardized HIPAA policies exist and contain structured versioning metadata headers');
  }

  // --- TEST GROUP 6: Governance Registers & Assessment Artifacts Verification ---
  console.log('\n--- TEST GROUP 6: Governance Registers & Assessment Artifacts Verification ---');
  {
    const projectRoot = path.resolve(__dirname, '..');
    const requiredRegisters = [
      'HIPAA_CONTROL_MATRIX.md',
      'HIPAA_RISK_ANALYSIS.md',
      'HIPAA_RISK_TREATMENT_REGISTER.md',
      'SECURITY_RESPONSIBILITY_REGISTER.md',
      'WORKFORCE_ACCESS_MATRIX.md',
      'WORKFORCE_LIFECYCLE_POLICY.md',
      'SECURITY_TRAINING_RECORD.md',
      'MFA_READINESS_PLAN.md',
      'SECURITY_EVALUATION_POLICY.md',
      'COMPLIANCE_DOCUMENT_RETENTION_POLICY.md',
      'HIPAA_PRIVACY_GAP_ANALYSIS.md',
      'HIPAA_NPP_TEMPLATE.md',
      'BAA_REGISTER.md',
      'VENDOR_RISK_REGISTER.md',
      'SECURITY_EVIDENCE_REGISTER.md'
    ];

    let allRegistersExist = true;
    for (const file of requiredRegisters) {
      if (!fs.existsSync(path.join(projectRoot, file))) {
        allRegistersExist = false;
        console.error(`Missing register: ${file}`);
        break;
      }
    }
    assert(allRegistersExist, 'All 15 root compliance registers and threat analysis governance documents exist');
  }

  // --- TEST GROUP 7: Deactivated User Immediate Session Lockout Verification ---
  console.log('\n--- TEST GROUP 7: Deactivated User Immediate Session Lockout Verification ---');
  {
    // Test deactivation behavior
    await prisma.user.update({
      where: { id: specialistUser.id },
      data: { isActive: false }
    });

    const deactivatedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${specialistToken}` }
    });
    assert(deactivatedRes.statusCode === 403, 'Deactivated specialist account is immediately rejected with 403 Forbidden');

    // Restore active status
    await prisma.user.update({
      where: { id: specialistUser.id },
      data: { isActive: true }
    });

    const reactivatedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { authorization: `Bearer ${specialistToken}` }
    });
    assert(reactivatedRes.statusCode === 200, 'Re-enabled specialist account successfully regains authorized API access');
  }

  await app.close();

  console.log('\n================================================================');
  console.log(`  STEP 13 COMPLIANCE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
