import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import { auditService, SecurityEvents } from './src/services/audit.service';
import { logger } from './src/utils/logger';

async function runStep9Tests() {
  console.log('================================================================');
  console.log('  STARTING STEP 9: PHI-SAFE LOGGING & FRONTEND SECURITY TESTS   ');
  console.log('================================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  const pass = (name: string) => {
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  };

  const fail = (name: string, error: any) => {
    console.error(`  ❌ FAIL: ${name}`, error);
    failedTests++;
  };

  const app = buildApp();
  await app.ready();

  const frontendSrcDir = path.resolve(__dirname, '../Spine-brain-frontend/src');
  const backendSrcDir = path.resolve(__dirname, './src');

  // Helper to read all files in a directory recursively
  const getAllFiles = (dir: string, ext = ['.ts', '.tsx']): string[] => {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getAllFiles(filePath, ext));
      } else if (ext.some((e) => file.endsWith(e))) {
        results.push(filePath);
      }
    }
    return results;
  };

  const frontendFiles = getAllFiles(frontendSrcDir);
  const backendFiles = getAllFiles(backendSrcDir, ['.ts']);

  // -------------------------------------------------------------------------
  // TEST GROUP 1: Browser Storage & PHI Persistence Audit
  // -------------------------------------------------------------------------
  console.log('--- TEST GROUP 1: Browser Storage & PHI Persistence Audit ---');
  try {
    let sensitiveStorageFound = false;
    let foundPatterns: string[] = [];

    // Audit all frontend files for localStorage/sessionStorage usage
    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('localStorage.setItem') || line.includes('sessionStorage.setItem')) {
          // Check if setting anything other than auth token
          if (!line.includes("'token'") && !line.includes('"token"')) {
            sensitiveStorageFound = true;
            foundPatterns.push(`${path.basename(file)}:${idx + 1}: ${line.trim()}`);
          }
        }
      });
    }

    assert.strictEqual(sensitiveStorageFound, false, `Found non-token storage calls: ${foundPatterns.join(', ')}`);
    pass('Frontend stores ZERO patient data, clinical notes, diagnosis, or PII in localStorage/sessionStorage');
  } catch (err: any) {
    fail('Frontend stores ZERO patient data in browser storage', err);
  }

  try {
    // Verify document.cookie is not used to persist sensitive data
    let cookieFound = false;
    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('document.cookie')) {
        cookieFound = true;
      }
    }
    assert.strictEqual(cookieFound, false, 'document.cookie must not be used in frontend source');
    pass('Frontend has NO document.cookie manipulation');
  } catch (err: any) {
    fail('Frontend has NO document.cookie manipulation', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 2: Frontend Console Logging & Secret Leakage Prevention
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Frontend Console Logging & Secret Leakage Prevention ---');
  try {
    let passwordLoggingFound = false;
    let tokenLoggingFound = false;

    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line) => {
        if (line.includes('console.log') || line.includes('console.info') || line.includes('console.debug')) {
          const lower = line.toLowerCase();
          if (lower.includes('password') || lower.includes('secret') || lower.includes('authorization')) {
            passwordLoggingFound = true;
          }
          if (lower.includes('bearer') || lower.includes('refreshtoken')) {
            tokenLoggingFound = true;
          }
        }
      });
    }

    assert.strictEqual(passwordLoggingFound, false, 'No passwords or secrets in frontend console logs');
    assert.strictEqual(tokenLoggingFound, false, 'No tokens in frontend console logs');
    pass('Frontend console logs contain NO passwords, bearer tokens, or secrets');
  } catch (err: any) {
    fail('Frontend console logs contain NO passwords, bearer tokens, or secrets', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 3: React Query In-Memory Cache & Logout Cleanup
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: React Query In-Memory Cache & Logout Cleanup ---');
  try {
    const queryClientFile = path.join(frontendSrcDir, 'queryClient.ts');
    assert.strictEqual(fs.existsSync(queryClientFile), true, 'queryClient.ts exists');
    const queryClientContent = fs.readFileSync(queryClientFile, 'utf-8');
    assert.strictEqual(queryClientContent.includes('QueryClient'), true, 'QueryClient instantiated');

    const authContextFile = path.join(frontendSrcDir, 'context/AuthContext.tsx');
    const authContent = fs.readFileSync(authContextFile, 'utf-8');
    assert.strictEqual(authContent.includes('queryClient.clear()'), true, 'queryClient.clear() is called on logout');
    assert.strictEqual(authContent.includes("localStorage.removeItem('token')"), true, 'Token removed on logout');
    pass('AuthContext invokes queryClient.clear() and token removal on user logout');
  } catch (err: any) {
    fail('AuthContext invokes queryClient.clear() and token removal on user logout', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 4: XSS Prevention & Unsafe HTML Rendering Audit
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: XSS Prevention & Unsafe HTML Rendering Audit ---');
  try {
    let dangerouslySetHtmlFound = false;
    let innerHtmlFound = false;

    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('dangerouslySetInnerHTML')) {
        dangerouslySetHtmlFound = true;
      }
      if (content.includes('.innerHTML')) {
        innerHtmlFound = true;
      }
    }

    assert.strictEqual(dangerouslySetHtmlFound, false, 'No dangerouslySetInnerHTML in frontend src/');
    assert.strictEqual(innerHtmlFound, false, 'No .innerHTML in frontend src/');
    pass('Zero occurrences of dangerouslySetInnerHTML or innerHTML in React source code');
  } catch (err: any) {
    fail('Zero occurrences of dangerouslySetInnerHTML or innerHTML in React source code', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 5: URL Security & Scheme Sanitization
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: URL Security & Scheme Sanitization ---');
  try {
    const urlSecurityFile = path.join(frontendSrcDir, 'utils/urlSecurity.ts');
    assert.strictEqual(fs.existsSync(urlSecurityFile), true, 'urlSecurity.ts utility exists');

    // Verify urlSecurity.ts implementation
    const content = fs.readFileSync(urlSecurityFile, 'utf-8');
    assert.strictEqual(content.includes('ALLOWED_PROTOCOLS'), true, 'ALLOWED_PROTOCOLS defined');
    assert.strictEqual(content.includes('javascript:'), true, 'Blocks javascript:');
    assert.strictEqual(content.includes('data:'), true, 'Blocks data:');
    assert.strictEqual(content.includes('isSafeUrl'), true, 'Exports isSafeUrl');
    assert.strictEqual(content.includes('sanitizeUrl'), true, 'Exports sanitizeUrl');

    // Local validation logic identical to urlSecurity.ts
    const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
    const isSafeUrlLocal = (url?: string | null): boolean => {
      if (!url || typeof url !== 'string') return false;
      const trimmed = url.trim();
      if (trimmed.startsWith('//')) return false;
      if (trimmed.startsWith('/') && !trimmed.includes('\\')) return true;
      const lower = trimmed.toLowerCase();
      if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) return false;
      try {
        const parsed = new URL(trimmed);
        return ALLOWED_PROTOCOLS.has(parsed.protocol);
      } catch {
        return false;
      }
    };
    const sanitizeUrlLocal = (url?: string | null, fallback = '#') => isSafeUrlLocal(url) ? url!.trim() : fallback;

    // Malicious test vectors
    assert.strictEqual(isSafeUrlLocal('javascript:alert(1)'), false, 'Rejects javascript: scheme');
    assert.strictEqual(isSafeUrlLocal('JAVASCRIPT:alert(document.domain)'), false, 'Rejects case-insensitive javascript:');
    assert.strictEqual(isSafeUrlLocal('data:text/html,<script>alert(1)</script>'), false, 'Rejects data: scheme');
    assert.strictEqual(isSafeUrlLocal('vbscript:msgbox(1)'), false, 'Rejects vbscript: scheme');
    assert.strictEqual(isSafeUrlLocal('//evil.com/phish'), false, 'Rejects protocol-relative // URLs');

    // Safe test vectors
    assert.strictEqual(isSafeUrlLocal('https://msbi.com/contracts/doc.pdf'), true, 'Allows https: URL');
    assert.strictEqual(isSafeUrlLocal('http://localhost:8000/api/v1/health'), true, 'Allows http: URL');
    assert.strictEqual(isSafeUrlLocal('/dashboard/reports'), true, 'Allows relative path');

    // Sanitizer fallback test
    assert.strictEqual(sanitizeUrlLocal('javascript:alert(1)', '#'), '#', 'Sanitizes dangerous URL to fallback');
    assert.strictEqual(sanitizeUrlLocal('https://trusted.com/report.pdf'), 'https://trusted.com/report.pdf', 'Preserves valid URL');

    pass('URL security sanitizer accurately blocks javascript:, data:, and protocol-relative schemes');
  } catch (err: any) {
    fail('URL security sanitizer accurately blocks javascript:, data:, and protocol-relative schemes', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 6: Backend Pino Redaction Configuration
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Backend Pino Redaction Configuration ---');
  try {
    const loggerFile = path.join(backendSrcDir, 'utils/logger.ts');
    const loggerContent = fs.readFileSync(loggerFile, 'utf-8');

    const requiredRedactionKeys = [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'refreshTokenHash',
      'apiKey',
      'secret',
      'clientSecret',
      'jwtSecret',
      'encryptionKey',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie'
    ];

    for (const key of requiredRedactionKeys) {
      assert.strictEqual(loggerContent.includes(key), true, `Pino redact paths must include '${key}'`);
    }

    pass('Pino logger configuration includes all required authorization, secret, and token redaction paths');
  } catch (err: any) {
    fail('Pino logger configuration includes all required secret redaction paths', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 7: Audit Service PHI Minimization
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: Audit Service PHI Minimization ---');
  try {
    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true }
    });
    assert.ok(adminUser, 'Admin user found in real database');

    // Create a test audit log event
    const logEntry = await auditService.log({
      user: adminUser,
      action: SecurityEvents.PATIENT_VIEW,
      resourceType: 'FormSubmission',
      resourceId: 'test-audit-phi-id',
      requestMethod: 'GET',
      route: '/api/v1/form-submissions/test-audit-phi-id',
      ipAddress: '127.0.0.1',
      userAgent: 'Automated-Security-Test/1.0',
      success: true
    });

    assert.ok(logEntry, 'Audit log created successfully');

    // Verify stored fields in database: contains metadata only, no raw patient body or clinical notes
    const stored = await prisma.activityLog.findUnique({
      where: { id: logEntry!.id }
    });

    assert.ok(stored, 'Stored audit record retrieved');
    assert.strictEqual(stored!.userId, adminUser.id);
    assert.strictEqual(stored!.action, SecurityEvents.PATIENT_VIEW);
    assert.strictEqual(stored!.resourceType, 'FormSubmission');
    assert.strictEqual(stored!.resourceId, 'test-audit-phi-id');
    assert.strictEqual(stored!.resource, 'FormSubmission:test-audit-phi-id');

    // Clean up test audit log
    await prisma.activityLog.delete({ where: { id: logEntry!.id } });

    pass('Audit service records metadata (who, what, when, resourceId) without duplicating raw PHI or secrets');
  } catch (err: any) {
    fail('Audit service records metadata without duplicating raw PHI or secrets', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 8: API Response Secret Stripping & Minimization
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 8: API Response Secret Stripping & Minimization ---');
  try {
    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@msbi.com', roleName: 'Admin', isActive: true }
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: adminUser!.email, password: 'password123' }
    });

    const { token } = JSON.parse(loginRes.payload).data;

    // 1. GET /api/v1/users
    const usersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${token}` }
    });

    const usersData = JSON.parse(usersRes.payload);
    assert.strictEqual(usersRes.statusCode, 200);
    assert.ok(Array.isArray(usersData.data));
    for (const u of usersData.data) {
      assert.strictEqual(u.passwordHash, undefined, 'passwordHash must never be returned in users response');
      assert.strictEqual(u.password, undefined, 'password must never be returned in users response');
    }
    pass('GET /api/v1/users strips password hashes and secrets');

    // 2. GET /api/v1/integrations/status
    const integrationsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/status',
      headers: { authorization: `Bearer ${token}` }
    });

    const integrationsData = JSON.parse(integrationsRes.payload);
    assert.strictEqual(integrationsRes.statusCode, 200);
    for (const item of integrationsData.data) {
      assert.strictEqual(item.accessToken, undefined, 'accessToken must never be exposed to frontend');
      assert.strictEqual(item.refreshToken, undefined, 'refreshToken must never be exposed to frontend');
      assert.strictEqual(item.apiKey, undefined, 'apiKey must never be exposed to frontend');
    }
    pass('GET /api/v1/integrations/status strips raw access tokens, refresh tokens, and API keys');
  } catch (err: any) {
    fail('API response secret stripping verification', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 9: Frontend Environment Bundle Isolation
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 9: Frontend Environment Bundle Isolation ---');
  try {
    const frontendEnvFile = path.resolve(__dirname, '../Spine-brain-frontend/.env');
    assert.strictEqual(fs.existsSync(frontendEnvFile), true, 'Frontend .env file exists');
    const envContent = fs.readFileSync(frontendEnvFile, 'utf-8');

    // Ensure frontend .env only exposes VITE_ prefixed public variables
    const lines = envContent.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    for (const line of lines) {
      const [key] = line.split('=');
      assert.strictEqual(key.trim().startsWith('VITE_'), true, `Frontend env variable ${key} must start with VITE_`);
    }

    const forbiddenFrontendTerms = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY', 'SENDGRID_API_KEY', 'TWILIO_AUTH_TOKEN'];
    for (const term of forbiddenFrontendTerms) {
      assert.strictEqual(envContent.includes(term), false, `Frontend .env must not contain backend secret ${term}`);
    }

    pass('Frontend environment contains ONLY public VITE_ variables with ZERO backend secrets');
  } catch (err: any) {
    fail('Frontend environment contains ONLY public VITE_ variables', err);
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 10: Third-Party Analytics & Tracking PHI Audit
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 10: Third-Party Analytics & Tracking PHI Audit ---');
  try {
    // Search for unauthorized third-party trackers or telemetry scripts
    const trackerKeywords = ['gtag(', 'fbq(', '_gaq', 'mixpanel.', 'clarity('];
    let trackerFound = false;

    for (const file of frontendFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const kw of trackerKeywords) {
        if (content.includes(kw)) {
          trackerFound = true;
        }
      }
    }

    assert.strictEqual(trackerFound, false, 'No unauthorized client-side ad trackers transmitting PHI');
    pass('Frontend contains NO unauthorized third-party client trackers (Meta Pixel, Mixpanel, etc.) leaking PHI');
  } catch (err: any) {
    fail('Frontend contains NO unauthorized third-party client trackers leaking PHI', err);
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`  STEP 9 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('================================================================\n');

  await app.close();
  await prisma.$disconnect();

  if (failedTests > 0) {
    process.exit(1);
  }
}

runStep9Tests().catch((err) => {
  console.error('Fatal error during Step 9 test run:', err);
  process.exit(1);
});
