import { execSync } from 'child_process';

const suites = [
  { name: 'Step 2: Authentication', script: 'test_auth_security.ts' },
  { name: 'Step 3: RBAC & Permissions', script: 'test_rbac_security.ts' },
  { name: 'Step 4: Resource Authorization / IDOR', script: 'test_resource_authorization.ts' },
  { name: 'Step 5: Audit Logging', script: 'test_audit_logging.ts' },
  { name: 'Step 6: Session & JWT Security', script: 'test_session_security.ts' },
  { name: 'Step 7: Secrets & Environment Security', script: 'test_secrets_security.ts' },
  { name: 'Step 8: API Security & Rate Limiting', script: 'test_api_security.ts' },
  { name: 'Step 9: PHI-Safe Logging & Frontend Security', script: 'test_phi_frontend_security.ts' },
  { name: 'Step 10: Files / Documents / Data Export', script: 'test_file_security.ts' },
  { name: 'Step 11: Third-Party Integrations & BAA Readiness', script: 'test_third_party_security.ts' },
  { name: 'Step 12: Infrastructure, DR & Operational Security', script: 'test_infrastructure_security.ts' },
  { name: 'Step 13: HIPAA Compliance Controls & Governance', script: 'test_hipaa_compliance_controls.ts' },
  { name: 'Step 14: Multi-Factor Authentication (MFA)', script: 'test_mfa_security.ts' },
  { name: 'Step 15: Backup & Disaster Recovery Security', script: 'test_backup_recovery_security.ts' },
  { name: 'Step 16: Production Hardening & Final HIPAA Technical Control Verification', script: 'test_step16_final_security.ts' }
];

console.log('================================================================');
console.log('RUNNING COMPREHENSIVE SECURITY REGRESSION (STEPS 2 - 16)');
console.log('================================================================\n');

let totalPassed = 0;
let totalFailed = 0;
const results: any[] = [];

for (const suite of suites) {
  process.stdout.write(`Executing ${suite.name}... `);
  try {
    const output = execSync(`npx ts-node ${suite.script}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const passMatch = output.match(/(\d+)\s+PASSED/i);
    const failMatch = output.match(/(\d+)\s+FAILED/i);

    const passedCount = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failedCount = failMatch ? parseInt(failMatch[1], 10) : 0;

    totalPassed += passedCount;
    totalFailed += failedCount;

    results.push({
      suite: suite.name,
      passed: passedCount,
      failed: failedCount,
      status: failedCount === 0 ? 'PASSED' : 'FAILED'
    });

    console.log(`PASSED (${passedCount} assertions)`);
  } catch (err: any) {
    const output = (err.stdout || '') + (err.stderr || '');
    const passMatch = output.match(/(\d+)\s+PASSED/i);
    const failMatch = output.match(/(\d+)\s+FAILED/i);

    const passedCount = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failedCount = failMatch ? parseInt(failMatch[1], 10) : 1;

    totalPassed += passedCount;
    totalFailed += failedCount;

    results.push({
      suite: suite.name,
      passed: passedCount,
      failed: failedCount,
      status: 'FAILED'
    });

    console.log(`FAILED (${passedCount} passed, ${failedCount} failed)`);
    console.error(output.slice(-500));
  }
}

console.log('\n================================================================');
console.log('FINAL CUMULATIVE SECURITY VERIFICATION SUMMARY');
console.log('================================================================');
for (const res of results) {
  console.log(`- ${res.suite}: ${res.passed}/${res.passed + res.failed} ${res.status}`);
}
console.log('----------------------------------------------------------------');
console.log(`CUMULATIVE TOTAL: ${totalPassed}/${totalPassed + totalFailed} ASSERTIONS PASSED`);
console.log('================================================================\n');

if (totalFailed > 0) {
  process.exit(1);
}
