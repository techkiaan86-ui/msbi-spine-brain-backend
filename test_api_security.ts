import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './src/middlewares/auth.middleware';

async function runApiSecurityTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 8: API SECURITY HARDENING TEST SUITE');
  console.log('================================================================\n');

  const app = buildApp();
  await app.ready();

  process.env.GOOGLE_REVIEWS_WEBHOOK_SECRET = 'test-gr-secret-key-12345';
  process.env.WORDPRESS_FORM_WEBHOOK_SECRET = 'test-wp-secret-key-12345';

  // Load real users from database for authenticated testing
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true },
    include: { role: true, department: true }
  });

  const clinicalUser = await prisma.user.findFirst({
    where: { email: 'clinical@msbi.com', roleName: 'Clinical Lead', isActive: true },
    include: { role: true, department: true }
  });

  const specialistUser = await prisma.user.findFirst({
    where: { email: 'specialist@msbi.com', roleName: 'Specialist', isActive: true },
    include: { role: true, department: true }
  });

  if (!adminUser || !clinicalUser || !specialistUser) {
    throw new Error('Real database users not found. Test setup cannot proceed.');
  }

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

  // ============================================================================
  // TEST GROUP 1: CORS Configuration & Preflight
  // ============================================================================
  console.log('--- TEST GROUP 1: CORS Configuration & Preflight ---');

  // Test 1: Allowed local development origin
  const resCorsDev = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { origin: 'http://localhost:3000' }
  });
  assert(
    resCorsDev.statusCode === 200 &&
    resCorsDev.headers['access-control-allow-origin'] === 'http://localhost:3000' &&
    resCorsDev.headers['access-control-allow-credentials'] === 'true',
    'Allowed origin receives matching Access-Control-Allow-Origin with credentials'
  );

  // Test 2: Unauthorized external origin
  const resCorsUnauth = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { origin: 'http://malicious-site.attacker.com' }
  });
  assert(
    resCorsUnauth.headers['access-control-allow-origin'] === undefined ||
    resCorsUnauth.headers['access-control-allow-origin'] !== 'http://malicious-site.attacker.com',
    'Unauthorized external origin does NOT receive matching Access-Control-Allow-Origin'
  );

  // Test 3: Preflight OPTIONS request
  const resCorsPreflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/auth/login',
    headers: {
      origin: 'http://localhost:3000',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Content-Type,Authorization'
    }
  });
  assert(
    resCorsPreflight.statusCode === 204 || resCorsPreflight.statusCode === 200,
    'CORS preflight OPTIONS request returns 200/204 OK'
  );

  // Test 4: Server-to-server / curl request with no Origin header
  const resNoOrigin = await app.inject({
    method: 'GET',
    url: '/api/health'
  });
  assert(
    resNoOrigin.statusCode === 200,
    'Requests with no Origin header (server-to-server/curl) are permitted'
  );

  // ============================================================================
  // TEST GROUP 2: Security Headers
  // ============================================================================
  console.log('\n--- TEST GROUP 2: Defensive Security Headers ---');

  const resHeaders = await app.inject({
    method: 'GET',
    url: '/api/health'
  });

  // Test 5: X-Content-Type-Options
  assert(
    resHeaders.headers['x-content-type-options'] === 'nosniff',
    'X-Content-Type-Options: nosniff is attached to response'
  );

  // Test 6: X-Frame-Options
  assert(
    resHeaders.headers['x-frame-options'] === 'DENY',
    'X-Frame-Options: DENY is attached to response'
  );

  // Test 7: Referrer-Policy
  assert(
    resHeaders.headers['referrer-policy'] === 'strict-origin-when-cross-origin',
    'Referrer-Policy: strict-origin-when-cross-origin is attached to response'
  );

  // Test 8: Content-Security-Policy
  assert(
    typeof resHeaders.headers['content-security-policy'] === 'string' &&
    resHeaders.headers['content-security-policy'].includes("frame-ancestors 'none'"),
    'Content-Security-Policy with frame-ancestors is attached to response'
  );

  // ============================================================================
  // TEST GROUP 3: Request Correlation ID
  // ============================================================================
  console.log('\n--- TEST GROUP 3: Request Correlation / Request ID ---');

  // Test 9: Auto-generated request ID
  const resReqIdAuto = await app.inject({
    method: 'GET',
    url: '/api/health'
  });
  assert(
    typeof resReqIdAuto.headers['x-request-id'] === 'string' &&
    resReqIdAuto.headers['x-request-id'].length > 0,
    'Server attaches generated x-request-id to response header'
  );

  // Test 10: Caller-provided sanitized request ID
  const testReqId = 'req-trace-security-test-999';
  const resReqIdCaller = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { 'x-request-id': testReqId }
  });
  assert(
    resReqIdCaller.headers['x-request-id'] === testReqId,
    'Server preserves and propagates sanitized caller-provided x-request-id'
  );

  // ============================================================================
  // TEST GROUP 4: Request Size Limits & Content-Type Security
  // ============================================================================
  console.log('\n--- TEST GROUP 4: Request Body Limits & Content-Type Security ---');

  // Test 11: Oversized JSON payload (>1MB)
  const hugeString = 'A'.repeat(1.5 * 1024 * 1024); // 1.5MB
  const resOversized = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ email: 'admin@msbi.com', password: hugeString })
  });
  assert(
    resOversized.statusCode === 413,
    'Oversized JSON payload (>1MB) returns 413 Payload Too Large'
  );

  // Test 12: Unsupported Content-Type on JSON endpoint
  const resBadContentType = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'text/xml' },
    payload: '<xml>not allowed</xml>'
  });
  assert(
    resBadContentType.statusCode === 415 || resBadContentType.statusCode === 400,
    'Unsupported media type on JSON API returns 415 or 400'
  );

  // ============================================================================
  // TEST GROUP 5: Input Validation & Schema Guardrails
  // ============================================================================
  console.log('\n--- TEST GROUP 5: Input Validation & Schema Guardrails ---');

  // Test 13: Malformed UUID in route parameter
  const resBadUuid = await app.inject({
    method: 'GET',
    url: '/api/v1/campaigns/not-a-valid-uuid',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(
    resBadUuid.statusCode === 400,
    'Malformed UUID parameter returns 400 Bad Request'
  );

  // Test 14: Invalid Enum value in request body
  const resBadEnum = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: {
      type: 'INVALID_UNSUPPORTED_REPORT_TYPE',
      format: 'PDF',
      dateRange: { start: new Date().toISOString(), end: new Date().toISOString() }
    }
  });
  assert(
    resBadEnum.statusCode === 400,
    'Invalid enum value in request payload returns 400 Bad Request'
  );

  // Test 15: Oversized search query string (>100 characters)
  const hugeSearchQuery = 'x'.repeat(150);
  const resHugeSearch = await app.inject({
    method: 'GET',
    url: `/api/v1/users/activity-logs?search=${hugeSearchQuery}`,
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(
    resHugeSearch.statusCode === 400,
    'Oversized search query parameter (>100 chars) returns 400 Bad Request'
  );

  // Test 16: Form Submission UUID parameter validation
  const resBadFormUuid = await app.inject({
    method: 'GET',
    url: '/api/v1/form-submissions/123-bad-id',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(
    resBadFormUuid.statusCode === 400,
    'Invalid Form Submission ID format returns 400 Bad Request'
  );

  // ============================================================================
  // TEST GROUP 6: HTTP Method Security & Route Tampering
  // ============================================================================
  console.log('\n--- TEST GROUP 6: HTTP Method Security & Route Tampering ---');

  // Test 17: DELETE method on POST-only login endpoint
  const resMethodDeleteOnPost = await app.inject({
    method: 'DELETE',
    url: '/api/v1/auth/login'
  });
  assert(
    resMethodDeleteOnPost.statusCode === 404 || resMethodDeleteOnPost.statusCode === 405,
    'Calling DELETE on POST-only login endpoint returns 404/405 without execution'
  );

  // Test 18: GET method on POST-only logout endpoint
  const resMethodGetOnPost = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(
    resMethodGetOnPost.statusCode === 404 || resMethodGetOnPost.statusCode === 405,
    'Calling GET on POST-only logout endpoint returns 404/405'
  );

  // Test 19: POST method on GET-only health endpoint
  const resMethodPostOnGet = await app.inject({
    method: 'POST',
    url: '/api/health',
    payload: { test: 1 }
  });
  assert(
    resMethodPostOnGet.statusCode === 404 || resMethodPostOnGet.statusCode === 405,
    'Calling POST on GET-only health endpoint returns 404/405'
  );

  // ============================================================================
  // TEST GROUP 7: Production-Safe Error Sanitization
  // ============================================================================
  console.log('\n--- TEST GROUP 7: Production-Safe Error Sanitization ---');

  // Test 20: 404 Not Found response format
  const res404 = await app.inject({
    method: 'GET',
    url: '/api/v1/nonexistent-endpoint-test'
  });
  assert(
    res404.statusCode === 404 &&
    !JSON.stringify(res404.json()).includes('stack') &&
    !JSON.stringify(res404.json()).includes('DATABASE_URL'),
    '404 Not Found response does not leak stack trace or internal configuration'
  );

  // Test 21: Validation Error response format
  const res400 = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'not-an-email' }
  });
  assert(
    res400.statusCode === 400 &&
    res400.json().success === false &&
    !JSON.stringify(res400.json()).includes('stack'),
    '400 Validation Error response does not leak server stack traces'
  );

  // Test 22: Unauthenticated 401 response format
  const res401 = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/me'
  });
  assert(
    res401.statusCode === 401 &&
    res401.json().success === false,
    '401 Unauthorized response format is clean and safe'
  );

  // ============================================================================
  // TEST GROUP 8: Response Data Minimization & Secret Redaction
  // ============================================================================
  console.log('\n--- TEST GROUP 8: Response Data Minimization & Secret Redaction ---');

  // Test 23: User list never returns passwordHash
  const resUsers = await app.inject({
    method: 'GET',
    url: '/api/v1/users',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const usersBody = JSON.stringify(resUsers.json());
  assert(
    resUsers.statusCode === 200 &&
    !usersBody.includes('passwordHash') &&
    !usersBody.includes('$2a$') &&
    !usersBody.includes('$2b$'),
    'GET /api/v1/users response never returns password hashes or bcrypt strings'
  );

  // Test 24: Active sessions list never returns refreshTokenHash
  const resSessions = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/sessions',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const sessionsBody = JSON.stringify(resSessions.json());
  assert(
    resSessions.statusCode === 200 &&
    !sessionsBody.includes('refreshTokenHash') &&
    !sessionsBody.includes('tokenHash'),
    'GET /api/v1/auth/sessions response never returns refreshTokenHash'
  );

  // Test 25: Integrations status never returns raw API keys or client secrets
  const resIntegrations = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/status',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  const integrationsBody = JSON.stringify(resIntegrations.json());
  assert(
    resIntegrations.statusCode === 200 &&
    !integrationsBody.includes('clientSecret') &&
    !integrationsBody.includes('INTEGRATION_ENCRYPTION_KEY'),
    'GET /api/v1/integrations/status response never returns secrets or encryption keys'
  );

  // ============================================================================
  // TEST GROUP 9: SQL Injection Defense (Prisma Parameterization)
  // ============================================================================
  console.log('\n--- TEST GROUP 9: SQL Injection Defense ---');

  // Test 26: SQL Injection in search query
  const sqlInjectionString = "' OR '1'='1' -- ";
  const resSqlInject = await app.inject({
    method: 'GET',
    url: `/api/v1/users/activity-logs?search=${encodeURIComponent(sqlInjectionString)}`,
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(
    resSqlInject.statusCode === 200 &&
    Array.isArray(resSqlInject.json().data),
    'SQL injection payload in search string is safely parameterized with zero syntax errors'
  );

  // Test 27: SQL Injection with UNION SELECT / Boolean logic
  const sqlUnionString = "admin' OR '1'='1";
  const resSqlUnion = await app.inject({
    method: 'GET',
    url: `/api/v1/users/activity-logs?action=${encodeURIComponent(sqlUnionString)}`,
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(
    (resSqlUnion.statusCode === 200 && resSqlUnion.json().data.length === 0) || resSqlUnion.statusCode === 400,
    'SQL injection payload safely parameterized returning 0 records without executing raw SQL'
  );

  // ============================================================================
  // TEST GROUP 10: Webhook Hardening & Idempotency
  // ============================================================================
  console.log('\n--- TEST GROUP 10: Webhook Hardening & Idempotency ---');

  // Test 28: Missing webhook secret
  const resWhMissing = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    payload: { email: 'test@example.com' }
  });
  assert(
    resWhMissing.statusCode === 401,
    'Webhook request with missing secret returns 401 Unauthorized'
  );

  // Test 29: Invalid webhook secret
  const resWhInvalid = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    headers: { 'x-webhook-secret': 'wrong-secret-token' },
    payload: { email: 'test@example.com' }
  });
  assert(
    resWhInvalid.statusCode === 403,
    'Webhook request with invalid secret returns 403 Forbidden'
  );

  // Test 30: Google reviews webhook missing secret
  const resGrMissing = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/google-reviews',
    payload: { message: { data: 'eyJ0ZXN0IjoxfQ==' } }
  });
  assert(
    resGrMissing.statusCode === 401,
    'Google Reviews webhook without secret returns 401 Unauthorized'
  );

  // ============================================================================
  // TEST GROUP 11: Export & Rate Limiting Verification
  // ============================================================================
  console.log('\n--- TEST GROUP 11: Export & Rate Limiting Verification ---');

  // Test 31: Unauthenticated export generation
  const resExportUnauth = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    payload: {
      type: 'EXECUTIVE',
      format: 'PDF',
      dateRange: { start: new Date().toISOString(), end: new Date().toISOString() }
    }
  });
  assert(
    resExportUnauth.statusCode === 401,
    'Unauthenticated call to /api/v1/reports/generate returns 401 Unauthorized'
  );

  // Test 32: Unauthorized role access (Specialist has no budget permission: budget: false -> 403)
  const resBudgetForbidden = await app.inject({
    method: 'GET',
    url: '/api/v1/budget/overview',
    headers: { authorization: `Bearer ${specialistToken}` }
  });
  assert(
    resBudgetForbidden.statusCode === 403,
    'User without budget permission cannot access Budget API (returns 403 Forbidden)'
  );

  // Test 33: Login rate limiting behavior (rapid repeated requests)
  let rateLimited = false;
  for (let i = 0; i < 15; i++) {
    const resRate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'wrong@msbi.com', password: 'badpassword' }
    });
    if (resRate.statusCode === 429) {
      rateLimited = true;
      break;
    }
  }
  assert(
    rateLimited,
    'Repeated rapid requests to /api/v1/auth/login trigger 429 Too Many Requests rate limit'
  );

  console.log('\n================================================================');
  console.log(`  STEP 8 API SECURITY TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runApiSecurityTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
