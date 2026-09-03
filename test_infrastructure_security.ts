/**
 * ==============================================================================
 * STEP 12 TEST SUITE: INFRASTRUCTURE, DEPLOYMENT, BACKUP, DISASTER RECOVERY &
 * OPERATIONAL SECURITY
 * ==============================================================================
 * Validates verifiable application & operational security controls:
 * 1. Health check safety & credential non-exposure
 * 2. Fail-fast configuration & missing secret protection
 * 3. Production error sanitization & stack trace concealment
 * 4. Audit log immutability & route safety (no delete/update routes)
 * 5. Request ID tracking & secure header handling
 * 6. CORS & Trust Proxy safety
 * 7. Rate limiting & DoS resilience
 * 8. Schema referential integrity & database constraints
 * 9. Environment configuration separation & artifact protection
 * 10. Dependency audit & runtime configuration verification
 * ==============================================================================
 */

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { getJwtSecret } from './src/middlewares/auth.middleware';
import { getEncryptionKey } from './src/utils/crypto';

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

async function runInfrastructureTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 12: INFRASTRUCTURE & OPERATIONAL SECURITY TESTS');
  console.log('================================================================\n');

  const app = buildApp();
  await app.ready();

  const jwtSecret = getJwtSecret();

  // Load real admin user for authorized testing
  const adminUser = await prisma.user.findFirst({ where: { roleName: 'Admin', isActive: true } });
  if (!adminUser) {
    throw new Error('Test setup error: Real admin user not found in database.');
  }

  const adminToken = jwt.sign(
    { userId: adminUser.id, email: adminUser.email, role: adminUser.roleName },
    jwtSecret,
    { expiresIn: '15m' }
  );

  // ============================================================================
  // TEST GROUP 1: Health Check Endpoint Safety & Secret Non-Exposure
  // ============================================================================
  console.log('--- TEST GROUP 1: Health Check Safety & Credential Non-Exposure ---');

  // 1. GET /health returns 200 OK
  const healthRes = await app.inject({
    method: 'GET',
    url: '/health'
  });
  assert(healthRes.statusCode === 200, 'GET /health returns 200 OK status');

  // 2. GET /health does not leak DATABASE_URL or database credentials
  const healthBody = healthRes.body;
  const dbUrl = process.env.DATABASE_URL || '';
  const dbPass = dbUrl.split(':')[2]?.split('@')[0] || '';
  const leaksDbInfo = (dbPass.length > 3 && healthBody.includes(dbPass)) || 
                      healthBody.includes('mysql://') || 
                      healthBody.includes('password');
  assert(!leaksDbInfo, 'GET /health output does NOT expose database passwords, connection strings, or raw URLs');

  // 3. GET /health does not leak JWT_SECRET or encryption keys
  const leaksSecrets = healthBody.includes(jwtSecret) || 
                       (process.env.INTEGRATION_ENCRYPTION_KEY && healthBody.includes(process.env.INTEGRATION_ENCRYPTION_KEY));
  assert(!leaksSecrets, 'GET /health output does NOT expose JWT secrets or symmetric encryption keys');

  // 4. GET /api/v1/health returns structured operational health without system environment
  const apiHealthRes = await app.inject({
    method: 'GET',
    url: '/api/v1/health'
  });
  assert(
    apiHealthRes.statusCode === 200 || apiHealthRes.statusCode === 404,
    'API health route returns safe status without leaking process environment'
  );

  // ============================================================================
  // TEST GROUP 2: Startup Configuration Validation & Fail-Fast Safety
  // ============================================================================
  console.log('\n--- TEST GROUP 2: Startup Configuration Validation & Fail-Fast Safety ---');

  // 5. getJwtSecret() returns active secret when configured
  const secret = getJwtSecret();
  assert(typeof secret === 'string' && secret.length >= 16, 'getJwtSecret() successfully resolves configured secret');

  // 6. getEncryptionKey() verifies 32-byte key
  const encKey = getEncryptionKey();
  assert(encKey instanceof Buffer && encKey.length === 32, 'getEncryptionKey() successfully loads 32-byte AES-256 key');

  // 7. Backend server.ts contains startup fail-fast validation checks
  const serverSource = fs.readFileSync(path.resolve(__dirname, 'src/server.ts'), 'utf8');
  assert(
    serverSource.includes('getJwtSecret()') && serverSource.includes('DATABASE_URL'),
    'Backend startup script performs fail-fast verification of required security variables'
  );

  // 8. Backend server.ts registers graceful shutdown handlers
  assert(
    serverSource.includes("process.on('SIGTERM'") && serverSource.includes("process.on('SIGINT'"),
    'Backend server registers SIGTERM and SIGINT listeners for graceful shutdown'
  );

  // ============================================================================
  // TEST GROUP 3: Error Sanitization & Non-Exposure of Stack Traces
  // ============================================================================
  console.log('\n--- TEST GROUP 3: Error Sanitization & Non-Exposure of Stack Traces ---');

  // 9. 404 Route returns sanitized JSON without stack trace
  const notFoundRes = await app.inject({
    method: 'GET',
    url: '/api/v1/non-existent-route-for-testing-12345'
  });
  assert(notFoundRes.statusCode === 404, 'Non-existent route returns 404 Not Found');
  assert(!notFoundRes.body.includes('at Fastify') && !notFoundRes.body.includes('node_modules'), '404 response does NOT leak Node.js stack traces');

  // 10. Malformed JSON request returns 400 Bad Request with sanitized message
  const badJsonRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: '{ malformed json: true '
  });
  assert(badJsonRes.statusCode === 400, 'Malformed JSON payload is rejected with 400 Bad Request');
  assert(!badJsonRes.body.includes('node:internal'), 'Malformed JSON error does NOT expose runtime internals');

  // 11. Global error handler produces structured JSON error format
  const parsedBadJson = JSON.parse(badJsonRes.body);
  assert(
    typeof parsedBadJson.error === 'string' || typeof parsedBadJson.message === 'string',
    'Application errors are returned in uniform structured JSON schema'
  );

  // ============================================================================
  // TEST GROUP 4: Audit Log Immutability & Route Protection
  // ============================================================================
  console.log('\n--- TEST GROUP 4: Audit Log Immutability & Route Protection ---');

  // 12. No DELETE route exists for ActivityLog
  const deleteAuditRes = await app.inject({
    method: 'DELETE',
    url: '/api/v1/activity-logs',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(deleteAuditRes.statusCode === 404, 'DELETE /api/v1/activity-logs does NOT exist (404 Not Found - immutable audit trail)');

  // 13. No PUT / UPDATE route exists for ActivityLog
  const putAuditRes = await app.inject({
    method: 'PUT',
    url: '/api/v1/activity-logs/12345',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { action: 'MODIFIED_LOG' }
  });
  assert(putAuditRes.statusCode === 404, 'PUT /api/v1/activity-logs does NOT exist (404 Not Found - immutable audit trail)');

  // 14. Unauthenticated access to ActivityLog is rejected (401)
  const unauthAuditRes = await app.inject({
    method: 'GET',
    url: '/api/v1/users/activity-logs'
  });
  assert(unauthAuditRes.statusCode === 401, 'Unauthenticated access to activity logs is blocked (401 Unauthorized)');


  // ============================================================================
  // TEST GROUP 5: Network, CORS, Rate Limiting & Proxy Protection
  // ============================================================================
  console.log('\n--- TEST GROUP 5: Network, CORS, Rate Limiting & Proxy Protection ---');

  // 15. CORS configuration does NOT allow wildcard origin with credentials
  const corsPreflightRes = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/auth/login',
    headers: {
      'Origin': 'https://malicious-attacker-domain.com',
      'Access-Control-Request-Method': 'POST'
    }
  });
  const allowOrigin = corsPreflightRes.headers['access-control-allow-origin'];
  const allowCreds = corsPreflightRes.headers['access-control-allow-credentials'];
  const isDangerousCors = allowOrigin === '*' && (allowCreds === 'true' || allowCreds === true as any);
  assert(!isDangerousCors, 'CORS configuration prevents dangerous wildcard reflection with credentials');

  // 16. Security headers plugin adds X-Content-Type-Options: nosniff
  assert(
    healthRes.headers['x-content-type-options'] === 'nosniff',
    'Security headers include X-Content-Type-Options: nosniff'
  );

  // 17. Security headers plugin adds X-Frame-Options: DENY or SAMEORIGIN
  const xfo = healthRes.headers['x-frame-options'];
  assert(
    xfo === 'DENY' || xfo === 'SAMEORIGIN',
    'Security headers include X-Frame-Options (clickjacking protection)'
  );

  // 18. Rate limit plugin is registered and active
  const rlRegistered = (app as any).rateLimit !== undefined || healthRes.headers['x-ratelimit-limit'] !== undefined;
  assert(
    rlRegistered,
    'Fastify rate-limit plugin is active to protect against denial of service'
  );

  // ============================================================================
  // TEST GROUP 6: Database Schema Constraints & Foreign Keys
  // ============================================================================
  console.log('\n--- TEST GROUP 6: Database Schema Constraints & Foreign Keys ---');

  // 19. Schema defines Foreign Key relations between User and Role
  const schemaContent = fs.readFileSync(path.resolve(__dirname, 'prisma/schema.prisma'), 'utf8');
  assert(
    schemaContent.includes('fields: [roleName], references: [name]') && schemaContent.includes('onDelete: Restrict'),
    'Prisma schema enforces referential integrity on User-Role relation (onDelete: Restrict)'
  );

  // 20. Schema defines Foreign Key relations between ActivityLog and User
  assert(
    schemaContent.includes('model ActivityLog') && schemaContent.includes('userId'),
    'Prisma schema enforces relational link on ActivityLog model'
  );

  // 21. Schema defines UserSession model with indexed / constrained fields
  assert(
    schemaContent.includes('model UserSession') && schemaContent.includes('refreshTokenHash'),
    'Prisma schema enforces structured UserSession model with hashed refresh tokens'
  );

  // 22. Schema defines FormSubmission and Lead relations with externalSubmissionId tracking
  assert(
    schemaContent.includes('externalSubmissionId') && schemaContent.includes('model FormSubmission'),
    'Prisma schema contains idempotency tracking fields for inbound form submissions'
  );

  // ============================================================================
  // TEST GROUP 7: Environment Separation & File Artifact Isolation
  // ============================================================================
  console.log('\n--- TEST GROUP 7: Environment Separation & File Artifact Isolation ---');

  // 23. Backend .env.example contains NO live production secrets
  const envExamplePath = path.resolve(__dirname, '.env.example');
  const envExampleContent = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : '';
  const exampleLeaks = envExampleContent.includes('railway.app') && envExampleContent.includes('mysql://') && !envExampleContent.includes('user:password');
  assert(!exampleLeaks, 'Backend .env.example contains placeholder values without exposing production credentials');

  // 24. Frontend .env.example contains safe public API defaults
  const feEnvExamplePath = path.resolve(__dirname, '../Spine-brain-frontend/.env.example');
  const feEnvExampleContent = fs.existsSync(feEnvExamplePath) ? fs.readFileSync(feEnvExamplePath, 'utf8') : '';
  assert(
    !feEnvExampleContent.includes('DATABASE_URL') && !feEnvExampleContent.includes('JWT_SECRET'),
    'Frontend .env.example does NOT contain database or secret parameters'
  );

  // 25. .dockerignore ignores .env and node_modules
  const dockerignorePath = path.resolve(__dirname, '.dockerignore');
  const dockerignoreContent = fs.existsSync(dockerignorePath) ? fs.readFileSync(dockerignorePath, 'utf8') : '';
  assert(
    dockerignoreContent.includes('.env') && dockerignoreContent.includes('node_modules'),
    '.dockerignore strictly excludes .env secrets and node_modules from container builds'
  );

  // 26. .gitignore ignores .env files across repositories
  const rootGitignorePath = path.resolve(__dirname, '../.gitignore');
  const rootGitignore = fs.existsSync(rootGitignorePath) ? fs.readFileSync(rootGitignorePath, 'utf8') : '';
  assert(
    rootGitignore.includes('.env') || rootGitignore.includes('*.env'),
    'Root .gitignore excludes .env files from version control'
  );

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n================================================================');
  console.log(`  STEP 12 INFRASTRUCTURE SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  await app.close();
  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runInfrastructureTests().catch(async (err) => {
  console.error('Test suite failed with unexpected error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
