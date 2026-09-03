import { wordpressFormWebhookSchema } from './src/validators/webhooks.schema';

const testCases = [
  // Valid cases
  { name: 'String Phone', val: 'Phone', expected: ['Phone'] },
  { name: 'String Email', val: 'Email', expected: ['Email'] },
  { name: 'String Phone, Email', val: 'Phone, Email', expected: ['Phone', 'Email'] },
  { name: 'String Phone,Email (no space)', val: 'Phone,Email', expected: ['Phone', 'Email'] },
  { name: 'Array Phone', val: ['Phone'], expected: ['Phone'] },
  { name: 'Array Email', val: ['Email'], expected: ['Email'] },
  { name: 'Array Phone, Email', val: ['Phone', 'Email'], expected: ['Phone', 'Email'] },
  // Invalid cases (should throw)
  { name: 'Invalid string SMS', val: 'SMS', expectError: true },
  { name: 'Invalid string Phone, SMS', val: 'Phone, SMS', expectError: true },
  { name: 'Invalid array', val: ['Phone', 'SMS'], expectError: true },
  { name: 'Arbitrary string', val: 'Hello World', expectError: true },
];

let failed = false;

for (const tc of testCases) {
  try {
    const res = wordpressFormWebhookSchema.parse({
      metadata: { preferredContactMethod: tc.val }
    });
    if (tc.expectError) {
      console.error(`❌ FAILED: ${tc.name} should have thrown an error but didn't!`);
      failed = true;
    } else {
      const output = res.metadata?.preferredContactMethod;
      if (JSON.stringify(output) === JSON.stringify(tc.expected)) {
        console.log(`✅ PASSED: ${tc.name} -> ${JSON.stringify(output)}`);
      } else {
        console.error(`❌ FAILED: ${tc.name} parsed as ${JSON.stringify(output)}, expected ${JSON.stringify(tc.expected)}`);
        failed = true;
      }
    }
  } catch (err) {
    if (tc.expectError) {
      console.log(`✅ PASSED: ${tc.name} correctly threw validation error.`);
    } else {
      console.error(`❌ FAILED: ${tc.name} threw unexpected error:`, err.issues);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log('All tests passed!');
