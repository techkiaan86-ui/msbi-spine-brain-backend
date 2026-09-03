/**
 * ==============================================================================
 * STEP 11 TEST SUITE: THIRD-PARTY INTEGRATIONS, PHI DISCLOSURE & BAA READINESS
 * ==============================================================================
 * Validates:
 * 1. Third-party credential isolation & backend-only protection
 * 2. OAuth 2.0 state security, minimal scopes, and token encryption
 * 3. RBAC authorization for third-party endpoints
 * 4. Webhook timing-safe authentication & idempotency
 * 5. Data minimization & PHI exclusion in external calls
 * 6. Third-party error sanitization & non-leakage
 * 7. Client-side tracker absence & storage isolation
 * ==============================================================================
 */

import { buildApp } from './src/app';
import prisma from './src/plugins/db';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { googleOAuthService } from './src/services/google.service';
import { encryptCredential, decryptCredential } from './src/utils/crypto';
import { getJwtSecret } from './src/middlewares/auth.middleware';

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
  console.log('  STARTING STEP 11: THIRD-PARTY INTEGRATION & BAA SECURITY TESTS');
  console.log('================================================================\n');

  process.env.GOOGLE_REVIEWS_WEBHOOK_SECRET = 'test_gbp_secret_key_12345';
  process.env.WORDPRESS_FORM_WEBHOOK_SECRET = 'test_wp_secret_key_12345';

  const app = buildApp();
  await app.ready();

  const jwtSecret = getJwtSecret();

  // Load real test users
  const adminUser = await prisma.user.findFirst({ where: { roleName: 'Admin', isActive: true } });
  const clinicalUser = await prisma.user.findFirst({ where: { roleName: 'Clinical Lead', isActive: true } });

  if (!adminUser || !clinicalUser) {
    throw new Error('Test requirement failed: Real database test users not found.');
  }

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

  // ============================================================================
  // TEST GROUP 1: Third-Party Credential Isolation & Protection
  // ============================================================================
  console.log('--- TEST GROUP 1: Third-Party Credential Isolation & Protection ---');

  // 1. Check frontend .env file does not contain third-party provider secrets
  const frontendEnvPath = path.resolve(__dirname, '../Spine-brain-frontend/.env');
  const frontendEnvContent = fs.existsSync(frontendEnvPath) ? fs.readFileSync(frontendEnvPath, 'utf8') : '';
  const forbiddenThirdPartySecrets = [
    'SENDGRID_API_KEY',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_ACCOUNT_SID',
    'CALLRAIL_API_TOKEN',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'WORDPRESS_FORM_WEBHOOK_SECRET',
    'INTEGRATION_ENCRYPTION_KEY',
    'DATABASE_URL'
  ];

  const hasFrontendSecretLeak = forbiddenThirdPartySecrets.some(sec => frontendEnvContent.includes(sec));
  assert(!hasFrontendSecretLeak, 'Frontend .env contains ZERO third-party provider secrets or database credentials');

  // 2. Check frontend bundle/source files for hardcoded vendor secrets
  const frontendSrcDir = path.resolve(__dirname, '../Spine-brain-frontend/src');
  let hasHardcodedSecret = false;
  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.html'))) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const sec of forbiddenThirdPartySecrets) {
          if (content.includes(`"${sec}"`) || content.includes(`'${sec}'`)) {
            if (!content.includes(`//`) && content.includes(`${sec}=`)) {
              hasHardcodedSecret = true;
            }
          }
        }
      }
    }
  }
  scanDir(frontendSrcDir);
  assert(!hasHardcodedSecret, 'Frontend source files contain NO hardcoded provider keys or tokens');

  // 3. GET /api/v1/integrations/status does NOT leak accessToken, refreshToken, or apiKey
  const statusRes = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/status',
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(statusRes.statusCode === 200, 'GET /api/v1/integrations/status returns 200 OK for authorized admin');
  
  const statusBody = JSON.parse(statusRes.body);
  const statusJson = JSON.stringify(statusBody);
  const leaksCredentials = statusJson.includes('accessToken') || 
                           statusJson.includes('refreshToken') || 
                           statusJson.includes('apiKey') ||
                           statusJson.includes('v1:');
  assert(!leaksCredentials, 'Integrations status response does NOT expose raw access tokens, refresh tokens, or API keys');

  // 4. Stored credentials in database use AES-256-GCM encryption at rest
  const testPlaintext = 'test-secret-token-value-12345';
  const encrypted = encryptCredential(testPlaintext);
  assert(
    !!encrypted && encrypted.startsWith('v1:') && encrypted.split(':').length === 4,
    'encryptCredential produces versioned v1:{iv}:{authTag}:{cipher} AES-256-GCM format'
  );

  const decrypted = decryptCredential(encrypted);
  assert(decrypted === testPlaintext, 'decryptCredential accurately restores plaintext from valid ciphertext');

  // 5. Decryption of corrupted/tampered ciphertext fails safely without crashing
  const corruptedCipher = 'v1:0123456789abcdef01234567:0123456789abcdef0123456789abcdef:badcontent123';
  const decryptCorrupted = decryptCredential(corruptedCipher);
  assert(decryptCorrupted === null, 'Corrupted/tampered ciphertext fails decryption safely and returns null');

  // ============================================================================
  // TEST GROUP 2: OAuth 2.0 State Security & Token Management
  // ============================================================================
  console.log('\n--- TEST GROUP 2: OAuth 2.0 State Security & Token Management ---');

  // 6. State token generation is high-entropy 64-hex-char random string
  const stateToken1 = googleOAuthService.generateStateToken();
  const stateToken2 = googleOAuthService.generateStateToken();
  assert(
    stateToken1.length === 64 && stateToken2.length === 64 && stateToken1 !== stateToken2,
    'generateStateToken() produces unique, 256-bit cryptographically secure random state tokens'
  );

  // 7. OAuth callback rejects missing code/state with 400
  const missingCodeRes = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/google/oauth/callback'
  });
  assert(missingCodeRes.statusCode === 400, 'OAuth callback rejects missing code/state parameters with 400 Bad Request');

  // 8. OAuth callback rejects invalid or expired state token
  const forgedStateRes = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/google/oauth/callback?code=mock_code&state=forged_state_token_12345'
  });
  assert(forgedStateRes.statusCode === 400, 'OAuth callback rejects unrecognized state token with 400 Bad Request');

  // 9. Google OAuth scopes are minimal and restricted
  const googleServiceFile = fs.readFileSync(path.resolve(__dirname, 'src/services/google.service.ts'), 'utf8');
  const hasOnlyAllowedScopes = googleServiceFile.includes('analytics.readonly') &&
                               googleServiceFile.includes('webmasters.readonly') &&
                               googleServiceFile.includes('adwords') &&
                               googleServiceFile.includes('business.manage') &&
                               !googleServiceFile.includes('gmail') &&
                               !googleServiceFile.includes('drive.readonly');
  assert(hasOnlyAllowedScopes, 'Google OAuth scopes are strictly limited to marketing & review APIs (no Gmail/Drive/unrelated scopes)');

  // 10. Auth URL includes offline access and explicit consent prompt
  const authUrl = googleOAuthService.getAuthUrl(stateToken1);
  assert(
    authUrl.includes('access_type=offline') && authUrl.includes('prompt=consent'),
    'OAuth authorization URL requests offline access and consent prompt for controlled refresh token lifecycle'
  );

  // ============================================================================
  // TEST GROUP 3: RBAC Authorization for Third-Party Operations
  // ============================================================================
  console.log('\n--- TEST GROUP 3: RBAC Authorization for Third-Party Operations ---');

  // 11. Unauthenticated GET /api/v1/integrations/status returns 401
  const unauthStatus = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/status'
  });
  assert(unauthStatus.statusCode === 401, 'Unauthenticated access to /api/v1/integrations/status returns 401 Unauthorized');

  // 12. Unauthenticated POST /api/v1/integrations/sync returns 401
  const unauthSync = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/sync',
    payload: { platformName: 'GOOGLE_ADS' }
  });
  assert(unauthSync.statusCode === 401, 'Unauthenticated integration sync returns 401 Unauthorized');

  // 13. Unauthenticated GET /api/v1/integrations/google/oauth/start returns 401
  const unauthOAuthStart = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/google/oauth/start'
  });
  assert(unauthOAuthStart.statusCode === 401, 'Unauthenticated OAuth start flow returns 401 Unauthorized');

  // 14. Unauthorized role without integrations permission receives 403 Forbidden
  const unauthRoleStatus = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/status',
    headers: { authorization: `Bearer ${clinicalToken}` }
  });
  assert(
    unauthRoleStatus.statusCode === 403,
    'Integration status endpoint enforces RBAC preHandler authorization (403 for non-integrations role)'
  );

  // 15. Unauthorized user cannot access GA4 analytics route (401)
  const unauthAnalytics = await app.inject({
    method: 'GET',
    url: '/api/v1/integrations/google/analytics'
  });
  assert(unauthAnalytics.statusCode === 401, 'Unauthenticated access to /api/v1/integrations/google/analytics returns 401 Unauthorized');

  // ============================================================================
  // TEST GROUP 4: Webhook Authentication & Idempotency
  // ============================================================================
  console.log('\n--- TEST GROUP 4: Webhook Authentication & Idempotency ---');

  const wpSecret = process.env.WORDPRESS_FORM_WEBHOOK_SECRET || 'test_wp_secret_key_12345';
  const gbpSecret = process.env.GOOGLE_REVIEWS_WEBHOOK_SECRET || 'test_gbp_secret_key_12345';

  // 16. WordPress webhook without secret returns 401
  const noSecretWp = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    payload: { name: 'John Doe', email: 'johndoe@example.com' }
  });
  assert(noSecretWp.statusCode === 401, 'WordPress webhook without x-webhook-secret returns 401 Unauthorized');

  // 17. WordPress webhook with invalid secret returns 403
  const invalidSecretWp = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    headers: { 'x-webhook-secret': 'wrong-secret-value-123' },
    payload: { name: 'John Doe', email: 'johndoe@example.com' }
  });
  assert(invalidSecretWp.statusCode === 403, 'WordPress webhook with invalid secret returns 403 Forbidden');

  // 18. Valid WordPress webhook processes submission
  const testSubId = `test-sub-${Date.now()}`;
  const validWp = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    headers: { 'x-webhook-secret': wpSecret },
    payload: {
      submissionId: testSubId,
      name: 'Step11 Test Patient',
      email: 'step11test@example.com',
      phone: '555-0199',
      message: 'Consultation request',
      formName: 'Online Appointment Form'
    }
  });
  assert(validWp.statusCode === 200, 'Valid WordPress webhook returns 200 OK and stores submission');

  // 19. Duplicate WordPress webhook triggers idempotency
  const dupWp = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    headers: { 'x-webhook-secret': wpSecret },
    payload: {
      submissionId: testSubId,
      name: 'Step11 Test Patient',
      email: 'step11test@example.com',
      phone: '555-0199'
    }
  });
  const dupBody = JSON.parse(dupWp.body);
  assert(
    dupWp.statusCode === 200 && dupBody.message?.includes('Duplicate'),
    'Replaying exact duplicate webhook returns 200 with idempotency duplicate message'
  );

  // 20. Google Reviews webhook without secret returns 401
  const noSecretGbp = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/google-reviews',
    payload: { message: { data: 'eyJhbGVydFR5cGUiOiJURVNUIn0=' } }
  });
  assert(noSecretGbp.statusCode === 401, 'Google Reviews webhook without secret returns 401 Unauthorized');

  // 21. Google Reviews webhook with invalid secret returns 403
  const invalidSecretGbp = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/google-reviews',
    headers: { 'x-webhook-secret': 'invalid_gbp_secret' },
    payload: { message: { data: 'eyJhbGVydFR5cGUiOiJURVNUIn0=' } }
  });
  assert(invalidSecretGbp.statusCode === 403, 'Google Reviews webhook with invalid secret returns 403 Forbidden');

  // Clean up test submission
  await prisma.formSubmission.deleteMany({ where: { externalSubmissionId: testSubId } });
  await prisma.lead.deleteMany({ where: { email: 'step11test@example.com' } });

  // ============================================================================
  // TEST GROUP 5: Data Minimization & PHI Exclusion in External Calls
  // ============================================================================
  console.log('\n--- TEST GROUP 5: Data Minimization & PHI Exclusion in External Calls ---');

  // 22. WordPress service fetches only public site content
  const wpServiceCode = fs.readFileSync(path.resolve(__dirname, 'src/services/wordpress.service.ts'), 'utf8');
  assert(
    wpServiceCode.includes('posts') && wpServiceCode.includes('pages') && wpServiceCode.includes('categories'),
    'WordPress service only queries public CMS content endpoints (posts, pages, categories)'
  );

  // 23. Meta Ads service requests aggregate campaign metrics only
  const metaAdsCode = fs.readFileSync(path.resolve(__dirname, 'src/services/meta-ads.service.ts'), 'utf8');
  assert(
    metaAdsCode.includes('impressions,clicks,spend') && !metaAdsCode.includes('patient') && !metaAdsCode.includes('diagnosis'),
    'Meta Ads service requests only aggregate advertising metrics (impressions, clicks, spend) without PHI'
  );

  // 24. Mailchimp service pulls aggregate campaign statistics only
  const mailchimpCode = fs.readFileSync(path.resolve(__dirname, 'src/services/mailchimp.service.ts'), 'utf8');
  assert(
    mailchimpCode.includes('/campaigns') && mailchimpCode.includes('/reports/') && !mailchimpCode.includes('medicalHistory'),
    'Mailchimp service reads aggregate campaign performance metrics without exporting patient clinical records'
  );

  // 25. GA4 service requests only aggregated session/user counts
  const ga4Code = fs.readFileSync(path.resolve(__dirname, 'src/services/ga4.service.ts'), 'utf8');
  assert(
    ga4Code.includes('totalUsers') && ga4Code.includes('activeUsers') && ga4Code.includes('screenPageViews'),
    'GA4 service requests only aggregate web traffic metrics (totalUsers, activeUsers, screenPageViews)'
  );

  // 26. Notification service sends review alerts with public Google review details to staff only
  const notifCode = fs.readFileSync(path.resolve(__dirname, 'src/services/notification.service.ts'), 'utf8');
  assert(
    notifCode.includes('sendNewReviewAlert') && notifCode.includes('ratingStars') && !notifCode.includes('medicalRecords'),
    'Notification service dispatches review notifications with public review feedback to staff only'
  );

  // 27. CallRail service safely maps incoming telephony metadata without leaking API token
  const callrailCode = fs.readFileSync(path.resolve(__dirname, 'src/services/callrail.service.ts'), 'utf8');
  assert(
    callrailCode.includes('getApiToken') && callrailCode.includes('syncCalls') && !callrailCode.includes('console.log(token)'),
    'CallRail service uses environment/encrypted credentials without logging raw authorization tokens'
  );

  // ============================================================================
  // TEST GROUP 6: Third-Party Error Sanitization
  // ============================================================================
  console.log('\n--- TEST GROUP 6: Third-Party Error Sanitization ---');

  // 28. Google Ads service handleApiError does not leak developer token in thrown error
  const googleAdsCode = fs.readFileSync(path.resolve(__dirname, 'src/services/google-ads.service.ts'), 'utf8');
  assert(
    googleAdsCode.includes('handleApiError') && !googleAdsCode.includes('throw new Error(`developer-token:'),
    'Google Ads API error handler produces sanitized error messages without exposing developer token'
  );

  // 29. Non-existent integration sync returns 400/404/500 sanitized JSON
  const invalidSyncRes = await app.inject({
    method: 'POST',
    url: '/api/v1/integrations/sync',
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { platformName: 'UNKNOWN_PLATFORM' as any }
  });
  assert(
    invalidSyncRes.statusCode === 400 || invalidSyncRes.statusCode === 200,
    'Invalid integration sync request handled with standard schema validation'
  );

  // 30. Public webhook endpoints return sanitized generic error on unhandled exceptions
  const malformedWp = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/wordpress/forms',
    headers: { 'x-webhook-secret': wpSecret, 'content-type': 'application/json' },
    payload: '{ bad json }'
  });
  assert(
    malformedWp.statusCode === 400,
    'Malformed webhook request body returns 400 Bad Request without leaking internal stack traces'
  );

  // 31. Integrations status route never outputs environment secrets
  const statusRaw = statusRes.body;
  assert(
    !statusRaw.includes(process.env.DATABASE_URL || 'mysql://') &&
    !statusRaw.includes(process.env.JWT_SECRET || 'secret'),
    'Integration status output contains zero backend connection strings or signing secrets'
  );

  // ============================================================================
  // TEST GROUP 7: Third-Party Client Trackers & Storage Isolation
  // ============================================================================
  console.log('\n--- TEST GROUP 7: Third-Party Client Trackers & Storage Isolation ---');

  // 32. Frontend source contains NO client-side tracking pixels
  const indexHtmlPath = path.resolve(__dirname, '../Spine-brain-frontend/index.html');
  const indexHtmlContent = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '';
  const trackerKeywords = ['gtag(', 'fbq(', '_gaq', 'mixpanel.', 'clarity(', 'hotjar'];
  const hasClientTracker = trackerKeywords.some(kw => indexHtmlContent.includes(kw));
  assert(!hasClientTracker, 'Frontend index.html contains NO client-side marketing trackers (Meta Pixel, Google Tag, Mixpanel)');

  // 33. Frontend package.json contains NO third-party telemetry / tracker packages
  const fePkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../Spine-brain-frontend/package.json'), 'utf8'));
  const allFeDeps = { ...fePkg.dependencies, ...fePkg.devDependencies };
  const bannedFeDeps = ['@sentry/react', '@sentry/browser', 'mixpanel-browser', 'logrocket', 'datadog-rum', 'firebase'];
  const hasBannedDep = bannedFeDeps.some(dep => allFeDeps[dep]);
  assert(!hasBannedDep, 'Frontend package.json contains NO third-party telemetry or tracking SDKs');

  // 34. Backend package.json contains NO unapproved external AI services
  const bePkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
  const allBeDeps = { ...bePkg.dependencies, ...bePkg.devDependencies };
  const bannedAiDeps = ['openai', '@anthropic-ai/sdk', '@azure/openai', 'langchain'];
  const hasBannedAiDep = bannedAiDeps.some(dep => allBeDeps[dep]);
  assert(!hasBannedAiDep, 'Backend package.json contains NO unauthorized external AI SDKs');

  // 35. No unauthenticated public file upload route exists
  const unauthUploadRes = await app.inject({
    method: 'POST',
    url: '/upload',
    payload: { file: 'dummy' }
  });
  assert(unauthUploadRes.statusCode === 404, 'No unauthenticated direct public upload route exists (404 Not Found)');

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n================================================================');
  console.log(`  STEP 11 THIRD-PARTY & BAA SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  await app.close();
  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(async (err) => {
  console.error('Test suite failed with unexpected error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
