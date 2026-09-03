import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';

// Mirror frontend sanitization logic for automated test verification
function sanitizeCsvCell(val: string | number): string {
  if (typeof val === 'number') return String(val);
  const str = String(val ?? '');
  const trimmed = str.trimStart();
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
  if (dangerousPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return `'${str}`;
  }
  return str;
}

function isSafeUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return false;
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function runFileSecurityTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 10: FILES, DOCUMENTS & DATA EXPORT SECURITY TESTS');
  console.log('================================================================\n');

  const app = buildApp();
  await app.ready();

  // Load real users from database
  const allUsers = await prisma.user.findMany({
    where: { isActive: true },
    include: { role: true, department: true }
  });

  const adminUser = allUsers.find(u => u.roleName === 'Admin');
  const clinicalUser = allUsers.find(u => u.roleName === 'Clinical Lead');
  const specialistUser = allUsers.find(u => u.roleName === 'Specialist');
  const managerUser = allUsers.find(u => u.roleName === 'Manager');

  if (!adminUser || !clinicalUser || !specialistUser) {
    throw new Error('Required real database users not found for test execution.');
  }

  // Find a user without 'vendors' permission
  const userWithoutVendors = allUsers.find(u => {
    const perms = typeof u.role?.permissions === 'object' ? u.role.permissions as any : JSON.parse((u.role?.permissions as string) || '{}');
    return u.roleName !== 'Admin' && perms['vendors'] !== true;
  }) || specialistUser;

  // Find a user with 'vendors' permission
  const userWithVendors = allUsers.find(u => {
    const perms = typeof u.role?.permissions === 'object' ? u.role.permissions as any : JSON.parse((u.role?.permissions as string) || '{}');
    return u.roleName === 'Admin' || perms['vendors'] === true;
  }) || adminUser;

  const jwtSecret = getJwtSecret();
  const adminToken = jwt.sign(
    { userId: adminUser.id, email: adminUser.email, role: adminUser.roleName },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const clinicalToken = jwt.sign(
    { userId: clinicalUser.id, email: clinicalUser.email, role: clinicalUser.roleName },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const specialistToken = jwt.sign(
    { userId: specialistUser.id, email: specialistUser.email, role: specialistUser.roleName },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const noVendorsToken = jwt.sign(
    { userId: userWithoutVendors.id, email: userWithoutVendors.email, role: userWithoutVendors.roleName },
    jwtSecret,
    { expiresIn: '15m' }
  );

  const vendorsToken = jwt.sign(
    { userId: userWithVendors.id, email: userWithVendors.email, role: userWithVendors.roleName },
    jwtSecret,
    { expiresIn: '15m' }
  );

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

  // -----------------------------------------------------------------------------
  // TEST GROUP 1: Report Generation & Export Authentication & RBAC
  // -----------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: Report Generation & Export Auth & RBAC ---');

  // 1. Unauthenticated call to /reports/generate
  const unauthGenerateRes = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    payload: {
      type: 'EXECUTIVE',
      format: 'PDF',
      dateRange: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z'
      }
    }
  });
  assert(unauthGenerateRes.statusCode === 401, 'Unauthenticated report generation returns 401 Unauthorized');

  // 2. Authorized call to /reports/generate (Admin)
  const authGenerateRes = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      type: 'EXECUTIVE',
      format: 'PDF',
      dateRange: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z'
      }
    }
  });
  assert(authGenerateRes.statusCode === 202, 'Authorized user generates report job returning 202 Accepted');
  const generateData = JSON.parse(authGenerateRes.body);
  assert(generateData.success === true && generateData.data?.jobId, 'Report generation returns valid job ID');

  // 3. Unauthenticated call to /reports/exports
  const unauthExportsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/reports/exports'
  });
  assert(unauthExportsRes.statusCode === 401, 'Unauthenticated export history listing returns 401 Unauthorized');

  // 4. Authorized call to /reports/exports (Admin)
  const authExportsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/reports/exports',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(authExportsRes.statusCode === 200, 'Authorized administrator can list export history (200 OK)');
  const exportsData = JSON.parse(authExportsRes.body);
  assert(Array.isArray(exportsData.data), 'Export history returns an array');

  // -----------------------------------------------------------------------------
  // TEST GROUP 2: Report Input Validation & Data Limits
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Report Input Validation & Range Limits ---');

  // 5. Invalid report type
  const invalidTypeRes = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      type: 'INVALID_TYPE',
      format: 'PDF',
      dateRange: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z'
      }
    }
  });
  assert(invalidTypeRes.statusCode === 400, 'Invalid report type rejected with 400 Bad Request');

  // 6. Invalid report format
  const invalidFormatRes = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      type: 'EXECUTIVE',
      format: 'HTML_EXECUTABLE',
      dateRange: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z'
      }
    }
  });
  assert(invalidFormatRes.statusCode === 400, 'Invalid format rejected with 400 Bad Request');

  // 7. Inverted date range (start > end)
  const invertedDateRes = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      type: 'EXECUTIVE',
      format: 'PDF',
      dateRange: {
        start: '2026-12-31T00:00:00.000Z',
        end: '2026-01-01T00:00:00.000Z'
      }
    }
  });
  assert(invertedDateRes.statusCode === 400, 'Inverted dateRange (start > end) rejected with 400 Bad Request');

  // 8. Valid report parameters accepted
  const validReportRes = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    headers: { authorization: `Bearer ${clinicalToken}` },
    payload: {
      type: 'MARKETING',
      format: 'EXCEL',
      dateRange: {
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-01-31T00:00:00.000Z'
      }
    }
  });
  assert(validReportRes.statusCode === 202, 'Valid marketing report request returns 202 Accepted');

  // -----------------------------------------------------------------------------
  // TEST GROUP 3: Audit Logging for Data Export Operations
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Data Export Audit Logging ---');

  // 9. Audit event was generated for DATA_EXPORT
  const latestExportLog = await prisma.activityLog.findFirst({
    where: {
      action: 'DATA_EXPORT',
      userId: adminUser.id
    },
    orderBy: { timestamp: 'desc' }
  });
  assert(!!latestExportLog, 'Report generation creates DATA_EXPORT audit trail entry');
  assert(latestExportLog?.resourceType === 'Report', 'Audit log records resourceType as Report');
  assert(latestExportLog?.userEmail === adminUser.email, 'Audit log records userEmail identity');
  assert(latestExportLog?.success === true, 'Audit log records operation outcome');

  // 10. Redaction in audit log
  assert(!JSON.stringify(latestExportLog).includes(adminUser.passwordHash), 'Audit log contains NO password hashes');
  assert(!JSON.stringify(latestExportLog).includes(adminToken), 'Audit log contains NO raw bearer tokens');

  // -----------------------------------------------------------------------------
  // TEST GROUP 4: Vendor Contract & Invoice Document URL Security
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Document & Attachment Access Controls ---');

  const validUuidV4 = 'a0000000-0000-4000-8000-000000000001';

  // 11. Unauthorized access to vendor contracts (user without vendors permission)
  const unauthContractsRes = await app.inject({
    method: 'GET',
    url: `/api/v1/vendors/${validUuidV4}/contracts`,
    headers: { authorization: `Bearer ${noVendorsToken}` }
  });
  assert(unauthContractsRes.statusCode === 403, 'Unauthorized user cannot access vendor contracts (403 Forbidden)');

  // 12. Unauthorized access to vendor invoices (user without vendors permission)
  const unauthInvoicesRes = await app.inject({
    method: 'GET',
    url: `/api/v1/vendors/${validUuidV4}/invoices`,
    headers: { authorization: `Bearer ${noVendorsToken}` }
  });
  assert(unauthInvoicesRes.statusCode === 403, 'Unauthorized user cannot access vendor invoices (403 Forbidden)');

  // 13. Unauthorized creation of vendor contracts
  const unauthCreateContractRes = await app.inject({
    method: 'POST',
    url: `/api/v1/vendors/${validUuidV4}/contracts`,
    headers: { authorization: `Bearer ${noVendorsToken}` },
    payload: {
      value: 5000,
      startDate: '2026-01-01T00:00:00.000Z',
      renewalDate: '2027-01-01T00:00:00.000Z',
      documentUrl: 'https://example.com/contract.pdf'
    }
  });
  assert(unauthCreateContractRes.statusCode === 403, 'Unauthorized user cannot create vendor contracts (403 Forbidden)');

  // 14. Unauthorized creation of vendor invoices
  const unauthCreateInvoiceRes = await app.inject({
    method: 'POST',
    url: `/api/v1/vendors/${validUuidV4}/invoices`,
    headers: { authorization: `Bearer ${noVendorsToken}` },
    payload: {
      amount: 1500,
      status: 'Pending',
      dueDate: '2026-03-01T00:00:00.000Z',
      documentUrl: 'https://example.com/invoice.pdf'
    }
  });
  assert(unauthCreateInvoiceRes.statusCode === 403, 'Unauthorized user cannot create vendor invoices (403 Forbidden)');

  // 15. Authorized user can access vendor contracts endpoint (RBAC passes; non-existent vendor → 200 empty or 404)
  const authContractsRes = await app.inject({
    method: 'GET',
    url: `/api/v1/vendors/${validUuidV4}/contracts`,
    headers: { authorization: `Bearer ${vendorsToken}` }
  });
  assert(
    authContractsRes.statusCode === 200 || authContractsRes.statusCode === 404,
    'Authorized user with vendors permission passes RBAC for contracts endpoint (200 or 404)'
  );

  // 16. Authorized user can access vendor invoices endpoint (RBAC passes; non-existent vendor → 200 empty or 404)
  const authInvoicesRes = await app.inject({
    method: 'GET',
    url: `/api/v1/vendors/${validUuidV4}/invoices`,
    headers: { authorization: `Bearer ${vendorsToken}` }
  });
  assert(
    authInvoicesRes.statusCode === 200 || authInvoicesRes.statusCode === 404,
    'Authorized user with vendors permission passes RBAC for invoices endpoint (200 or 404)'
  );

  // 17. Invalid document URL validation on contract creation (Admin)
  const invalidContractUrlRes = await app.inject({
    method: 'POST',
    url: `/api/v1/vendors/${validUuidV4}/contracts`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      value: 5000,
      startDate: '2026-01-01T00:00:00.000Z',
      renewalDate: '2027-01-01T00:00:00.000Z',
      documentUrl: 'not-a-valid-url'
    }
  });
  assert(invalidContractUrlRes.statusCode === 400, 'Invalid documentUrl rejected by schema with 400 Bad Request');

  // 18. Invalid document URL validation on invoice creation (Admin)
  const invalidInvoiceUrlRes = await app.inject({
    method: 'POST',
    url: `/api/v1/vendors/${validUuidV4}/invoices`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      amount: 1500,
      status: 'Pending',
      dueDate: '2026-03-01T00:00:00.000Z',
      documentUrl: 'javascript:alert(1)'
    }
  });
  assert(invalidInvoiceUrlRes.statusCode === 400, 'Dangerous non-URL documentUrl on invoice rejected with 400 Bad Request');

  // -----------------------------------------------------------------------------
  // TEST GROUP 5: Call Recording Audio URL Protection
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Call Recording Audio URL Protection ---');

  // 19. Unauthenticated access to call logs with audio URLs returns 401
  const unauthCallsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/calls'
  });
  assert(unauthCallsRes.statusCode === 401, 'Unauthenticated user cannot access call logs and audio URLs (401 Unauthorized)');

  // 20. Authorized user with analytics permission can access call logs
  const authCallsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/calls',
    headers: { authorization: `Bearer ${specialistToken}` }
  });
  assert(authCallsRes.statusCode === 200, 'Authorized specialist with analytics permission accesses call logs (200 OK)');

  // -----------------------------------------------------------------------------
  // TEST GROUP 6: CSV Formula Injection Defense
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: CSV Formula Injection Defense ---');

  // 21. Formula injection starting with '='
  const formulaEquals = sanitizeCsvCell('=cmd|\' /C calc\'!A0');
  assert(formulaEquals.startsWith("'="), 'Cell starting with = is neutralized with single quote prefix');

  // 22. Formula injection starting with '+'
  const formulaPlus = sanitizeCsvCell('+123456-7890');
  assert(formulaPlus.startsWith("'+"), 'Cell starting with + is neutralized with single quote prefix');

  // 23. Formula injection starting with '-'
  const formulaMinus = sanitizeCsvCell('-5+10');
  assert(formulaMinus.startsWith("'-"), 'Cell starting with - is neutralized with single quote prefix');

  // 24. Formula injection starting with '@'
  const formulaAt = sanitizeCsvCell('@SUM(1+1)');
  assert(formulaAt.startsWith("'@"), 'Cell starting with @ is neutralized with single quote prefix');

  // 25. Formula injection with tab prefix '\t='
  const formulaTab = sanitizeCsvCell('\t=1+1');
  assert(formulaTab.startsWith("'\t="), 'Cell with tab prefix \\t= is neutralized with single quote prefix');

  // 26. Standard text cell remains uncorrupted
  const normalText = sanitizeCsvCell('John Doe, Patient Consultation');
  assert(normalText === 'John Doe, Patient Consultation', 'Standard text cell is preserved without unnecessary modifications');

  // 27. Number values are preserved
  const numericVal = sanitizeCsvCell(1248.5);
  assert(numericVal === '1248.5', 'Numeric value is preserved accurately');

  // -----------------------------------------------------------------------------
  // TEST GROUP 7: Safe Document Link Sanitization
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: Safe Document Link Sanitization ---');

  // 28. Safe HTTPS document URL
  assert(isSafeUrl('https://storage.provider.com/contracts/vendor_agreement.pdf') === true, 'Safe HTTPS document URL is allowed');

  // 29. Executable javascript: scheme
  assert(isSafeUrl('javascript:fetch("/api/secrets")') === false, 'Dangerous javascript: scheme is rejected');

  // 30. Data URI scheme
  assert(isSafeUrl('data:text/html,<script>alert(1)</script>') === false, 'Dangerous data: scheme is rejected');

  // 31. Protocol-relative URL
  assert(isSafeUrl('//malicious-site.com/payload.pdf') === false, 'Protocol-relative URL is rejected');

  // -----------------------------------------------------------------------------
  // TEST GROUP 8: Export Confidentiality & Credential Exclusion
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 8: Export Confidentiality & Credential Exclusion ---');

  // 32. User list export endpoint never includes password hashes
  const usersExportRes = await app.inject({
    method: 'GET',
    url: '/api/v1/users',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const usersBody = usersExportRes.body;
  assert(!usersBody.includes('passwordHash') && !usersBody.includes('$2a$'), 'Exportable user data never returns password hashes');

  // 33. Integrations status endpoint never includes access tokens or encryption keys
  const integrationsRes = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/status',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const integrationsBody = integrationsRes.body;
  assert(!integrationsBody.includes('accessToken') && !integrationsBody.includes('clientSecret'), 'Integrations data never returns access tokens or secrets');

  // -----------------------------------------------------------------------------
  // TEST GROUP 9: Storage Architecture & File Upload Security
  // -----------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 9: Storage Architecture & File Upload Safety ---');

  // 34. Verify no unauthenticated public file upload route exists
  const publicUploadRes = await app.inject({
    method: 'POST',
    url: '/api/v1/upload',
    payload: { file: 'dummy' }
  });
  assert(publicUploadRes.statusCode === 404, 'No unauthenticated public file upload route exists (returns 404)');

  // 35. Verify no unauthenticated public file download route exists
  const publicDownloadRes = await app.inject({
    method: 'GET',
    url: '/api/v1/files/secret.pdf'
  });
  assert(publicDownloadRes.statusCode === 404, 'No unauthenticated public file download route exists (returns 404)');

  console.log('\n================================================================');
  console.log(`  STEP 10 FILE & EXPORT SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFileSecurityTests().catch((err) => {
  console.error('Fatal error in file security tests:', err);
  process.exit(1);
});
