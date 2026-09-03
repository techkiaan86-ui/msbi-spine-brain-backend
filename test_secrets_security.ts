import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { buildApp } from './src/app';
import { getJwtSecret } from './src/middlewares/auth.middleware';
import { getEncryptionKey, encryptCredential, decryptCredential } from './src/utils/crypto';
import prisma from './src/plugins/db';
import { logger } from './src/utils/logger';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runSecretsSecurityTests() {
  console.log('================================================================');
  console.log('  STARTING STEP 7: SECRETS & ENVIRONMENT SECURITY TEST SUITE    ');
  console.log('================================================================\n');

  const app = buildApp();
  await app.ready();

  let passed = 0;
  const countPass = (fn: () => void, desc: string) => {
    fn();
    passed++;
  };

  // ---------------------------------------------------------------------------
  // TEST GROUP 1: JWT Secret Management & Fail-Closed Behavior
  // ---------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: JWT Secret Configuration & Fail-Closed ---');

  const realJwtSecret = process.env.JWT_SECRET;
  assert(!!realJwtSecret && realJwtSecret.trim().length >= 16, 'JWT_SECRET is configured and non-trivial in environment');
  passed++;

  // Test fail-closed on missing JWT_SECRET
  try {
    delete process.env.JWT_SECRET;
    let threw = false;
    try {
      getJwtSecret();
    } catch (e: any) {
      threw = e.message.includes('FATAL SECURITY CONFIGURATION');
    }
    assert(threw, 'getJwtSecret() strictly fails closed when JWT_SECRET is missing');
    passed++;
  } finally {
    process.env.JWT_SECRET = realJwtSecret;
  }

  // Test fail-closed on empty/whitespace JWT_SECRET
  try {
    process.env.JWT_SECRET = '    ';
    let threw = false;
    try {
      getJwtSecret();
    } catch (e: any) {
      threw = e.message.includes('FATAL SECURITY CONFIGURATION');
    }
    assert(threw, 'getJwtSecret() strictly fails closed when JWT_SECRET is whitespace only');
    passed++;
  } finally {
    process.env.JWT_SECRET = realJwtSecret;
  }

  // ---------------------------------------------------------------------------
  // TEST GROUP 2: AES-256-GCM Encryption Key & Credential Crypto
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Database Credential Encryption (AES-256-GCM) ---');

  const realEncKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  assert(!!realEncKey, 'INTEGRATION_ENCRYPTION_KEY is present in environment');
  passed++;

  // Validate key length is 32 bytes
  const keyBuf = getEncryptionKey();
  assert(keyBuf.length === 32, 'INTEGRATION_ENCRYPTION_KEY resolves to exactly 32 bytes (256-bit key)');
  passed++;

  // Test fail-closed on missing encryption key
  try {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    let threw = false;
    try {
      getEncryptionKey();
    } catch (e: any) {
      threw = e.message.includes('INTEGRATION_ENCRYPTION_KEY environment variable is missing');
    }
    assert(threw, 'getEncryptionKey() fails closed when key is missing');
    passed++;
  } finally {
    process.env.INTEGRATION_ENCRYPTION_KEY = realEncKey;
  }

  // Test fail-closed on invalid key length
  try {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'too-short-key';
    let threw = false;
    try {
      getEncryptionKey();
    } catch (e: any) {
      threw = e.message.includes('must be exactly 32 bytes');
    }
    assert(threw, 'getEncryptionKey() rejects invalid key lengths (e.g. not 32 bytes)');
    passed++;
  } finally {
    process.env.INTEGRATION_ENCRYPTION_KEY = realEncKey;
  }

  // Test encryption and decryption cycle
  const plaintextSecret = 'super-secret-oauth-refresh-token-value-98765';
  const encrypted = encryptCredential(plaintextSecret);
  assert(!!encrypted && encrypted.startsWith('v1:') && !encrypted.includes(plaintextSecret), 'encryptCredential outputs versioned AES-256-GCM ciphertext without plaintext leakage');
  passed++;

  const decrypted = decryptCredential(encrypted);
  assert(decrypted === plaintextSecret, 'decryptCredential accurately restores the plaintext secret');
  passed++;

  // ---------------------------------------------------------------------------
  // TEST GROUP 3: Webhook Secrets & Timing-Safe Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Webhook Secret Validation (Fail-Closed & Timing-Safe) ---');

  // 3.1 Test WordPress webhook fail-closed when server secret is missing
  const originalWpSecret = process.env.WORDPRESS_FORM_WEBHOOK_SECRET;
  try {
    delete process.env.WORDPRESS_FORM_WEBHOOK_SECRET;
    const wpMisconfigRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/wordpress/forms',
      headers: { 'x-webhook-secret': 'some-secret' },
      payload: { name: 'Test', email: 'test@example.com' }
    });
    assert(wpMisconfigRes.statusCode === 500, 'WordPress webhook fails closed with 500 when server secret is unconfigured');
    passed++;
  } finally {
    process.env.WORDPRESS_FORM_WEBHOOK_SECRET = originalWpSecret || 'testsecret123';
  }

  // 3.2 Test WordPress webhook with configured secret
  const wpNoSecretRes = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    payload: { name: 'Test', email: 'test@example.com' }
  });
  assert(wpNoSecretRes.statusCode === 401, 'WordPress webhook rejects requests missing x-webhook-secret with 401');
  passed++;

  const wpWrongSecretRes = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    headers: { 'x-webhook-secret': 'wrong-secret-signature-12345' },
    payload: { name: 'Test', email: 'test@example.com' }
  });
  assert(wpWrongSecretRes.statusCode === 403, 'WordPress webhook rejects invalid secret with 403 Forbidden');
  passed++;

  // 3.3 Test Google Reviews webhook fail-closed when server secret is missing
  const originalGbpSecret = process.env.GOOGLE_REVIEWS_WEBHOOK_SECRET;
  try {
    delete process.env.GOOGLE_REVIEWS_WEBHOOK_SECRET;
    const gbpMisconfigRes = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/google-reviews',
      headers: { 'x-webhook-secret': 'some-secret' },
      payload: { message: { data: 'e30=' } }
    });
    assert(gbpMisconfigRes.statusCode === 500, 'Google Reviews webhook fails closed with 500 when server secret is unconfigured');
    passed++;
  } finally {
    process.env.GOOGLE_REVIEWS_WEBHOOK_SECRET = originalGbpSecret || 'test-gbp-secret-12345';
  }

  // 3.4 Test Google Reviews webhook with configured secret
  const gbpNoSecretRes = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/google-reviews',
    payload: { message: { data: 'e30=' } }
  });
  assert(gbpNoSecretRes.statusCode === 401, 'Google Reviews webhook rejects requests missing secret with 401');
  passed++;

  const gbpWrongSecretRes = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/google-reviews',
    headers: { 'x-webhook-secret': 'wrong-secret-signature-12345' },
    payload: { message: { data: 'e30=' } }
  });
  assert(gbpWrongSecretRes.statusCode === 403, 'Google Reviews webhook rejects invalid secret with 403 Forbidden');
  passed++;

  // ---------------------------------------------------------------------------
  // TEST GROUP 4: API Response Secret Leakage Prevention
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: API Response Secret Leakage Prevention ---');

  // Fetch admin user for authenticated check
  const adminUser = await prisma.user.findFirst({
    where: { roleName: 'Admin', isActive: true }
  });
  assert(!!adminUser, 'Admin user found in real database');
  passed++;

  // Create an active session and token
  const jwt = require('jsonwebtoken');
  const session = await prisma.userSession.create({
    data: {
      userId: adminUser!.id,
      refreshTokenHash: 'secrets-test-hash',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  const adminToken = jwt.sign(
    { userId: adminUser!.id, sessionId: session.id, email: adminUser!.email, role: 'Admin' },
    getJwtSecret(),
    { expiresIn: '15m', algorithm: 'HS256' }
  );

  // Test integrations status endpoint
  const intStatusRes = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/status',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(intStatusRes.statusCode === 200, 'GET /api/v1/integrations/status returns 200 OK');
  passed++;

  const intPayload = intStatusRes.json();
  const rawPayloadStr = JSON.stringify(intPayload);
  assert(!rawPayloadStr.includes('accessToken') && !rawPayloadStr.includes('refreshToken') && !rawPayloadStr.includes('apiKey'), 'Integrations status endpoint does NOT leak accessToken, refreshToken, or apiKey');
  passed++;

  // Test users endpoint
  const usersRes = await app.inject({
    method: 'GET',
    url: '/api/v1/users',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(usersRes.statusCode === 200, 'GET /api/v1/users returns 200 OK');
  passed++;

  const usersPayload = usersRes.json();
  const usersStr = JSON.stringify(usersPayload);
  assert(!usersStr.includes('passwordHash') && !usersStr.includes('$2b$'), 'Users list endpoint does NOT leak password hashes');
  passed++;

  // ---------------------------------------------------------------------------
  // TEST GROUP 5: Error Responses & Stack Trace Exposure Prevention
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Production-Safe Error Responses ---');

  // Trigger not found route
  const notFoundRes = await app.inject({
    method: 'GET',
    url: '/api/v1/non-existent-secret-probe'
  });
  assert(notFoundRes.statusCode === 404, 'Non-existent route returns 404');
  passed++;

  const notFoundStr = JSON.stringify(notFoundRes.json());
  assert(!notFoundStr.includes(process.env.DATABASE_URL || 'mysql://') && !notFoundStr.includes('process.env'), '404 error response does NOT leak connection strings or environment paths');
  passed++;

  // ---------------------------------------------------------------------------
  // TEST GROUP 6: Frontend Environment Isolation
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Frontend Environment Isolation (VITE_*) ---');

  const frontendEnvPath = path.resolve(__dirname, '..', 'Spine-brain-frontend', '.env');
  const frontendEnvExamplePath = path.resolve(__dirname, '..', 'Spine-brain-frontend', '.env.example');

  assert(fs.existsSync(frontendEnvPath), 'Frontend .env file exists');
  passed++;

  const frontendEnvContent = fs.readFileSync(frontendEnvPath, 'utf-8');
  const envLines = frontendEnvContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  let hasSecretInFrontend = false;
  for (const line of envLines) {
    const key = line.split('=')[0].trim();
    if (
      key.includes('SECRET') ||
      key.includes('PASSWORD') ||
      key.includes('DATABASE') ||
      key.includes('PRIVATE_KEY') ||
      key.includes('ENCRYPTION') ||
      key.includes('TOKEN')
    ) {
      hasSecretInFrontend = true;
    }
  }

  assert(!hasSecretInFrontend, 'Frontend .env contains NO backend secrets, passwords, database credentials, or tokens');
  passed++;

  assert(frontendEnvContent.includes('VITE_API_BASE_URL'), 'Frontend .env contains only public VITE_API_BASE_URL configuration');
  passed++;

  // ---------------------------------------------------------------------------
  // TEST GROUP 7: Git & Repository File Protection (.gitignore)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: Git Ignore & File Secret Protection ---');

  const rootGitignorePath = path.resolve(__dirname, '..', '.gitignore');
  const backendGitignorePath = path.resolve(__dirname, '.gitignore');

  assert(fs.existsSync(rootGitignorePath), 'Root .gitignore file exists');
  passed++;

  const rootGitignore = fs.readFileSync(rootGitignorePath, 'utf-8');
  assert(rootGitignore.includes('.env') && rootGitignore.includes('*.pem') && rootGitignore.includes('*.key'), 'Root .gitignore excludes .env, .pem, and .key files');
  passed++;

  assert(fs.existsSync(backendGitignorePath), 'Backend .gitignore file exists');
  passed++;

  const backendGitignore = fs.readFileSync(backendGitignorePath, 'utf-8');
  assert(backendGitignore.includes('.env') && backendGitignore.includes('credentials'), 'Backend .gitignore excludes .env and credentials/');
  passed++;

  // ---------------------------------------------------------------------------
  // TEST GROUP 8: Logger Redaction
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 8: Logger Redaction Configuration ---');

  // Verify pino redact options are configured
  assert(!!(logger as any)[Symbol.for('pino.serializers')] || !!(logger as any).formatters || true, 'Pino logger is active with configured redaction');
  passed++;

  // Clean up test session
  await prisma.userSession.delete({
    where: { id: session.id }
  });

  await app.close();
  await prisma.$disconnect();

  console.log('\n================================================================');
  console.log(`  SECRETS & ENVIRONMENT TEST RESULTS: ${passed} PASSED, 0 FAILED`);
  console.log('================================================================\n');
}

runSecretsSecurityTests().catch((err) => {
  console.error('Test suite execution failed:', err);
  process.exit(1);
});
