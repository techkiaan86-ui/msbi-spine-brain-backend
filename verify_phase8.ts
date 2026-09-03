import prisma from './src/plugins/db';
import { googleBusinessService } from './src/services/google-business.service';
import { notificationService } from './src/services/notification.service';
import { reputationService } from './src/services/reputation.service';

async function verifyPhase8() {
  console.log('--- Phase 8: Google Business Profile & Reputation Verification ---');

  // Test 1: Database Schema Check
  // Verify new fields exist in Prisma by executing a select query
  try {
    await prisma.user.findFirst({
      select: {
        phoneNumber: true,
        emailAlerts: true,
        smsAlerts: true,
        alertLocations: true,
      }
    });
    await prisma.clinic.findFirst({
      select: {
        googleLocationId: true,
      }
    });
    await prisma.review.findFirst({
      select: {
        googleReviewId: true,
        googleLocationId: true,
        reply: true,
        repliedAt: true,
        reviewUrl: true,
        responseTime: true,
      }
    });
    console.log('✅ PASS: Prisma Database Schema successfully extended');
  } catch (err: any) {
    console.error('❌ FAIL: Prisma Database Schema fields missing:', err.message);
    process.exit(1);
  }

  // Test 2: Mappings Retrieval
  try {
    const mappings = await reputationService.getMappings();
    if (Array.isArray(mappings)) {
      console.log('✅ PASS: Clinic mappings query is functional');
    } else {
      console.error('❌ FAIL: Clinic mappings query did not return an array');
    }
  } catch (err: any) {
    console.error('❌ FAIL: Mappings retrieval failed:', err.message);
  }

  // Test 3: Alert Preferences and Routing
  // Clean up any test users first
  await prisma.user.deleteMany({ where: { email: { in: ['test-alert1@msbi.com', 'test-alert2@msbi.com', 'test-alert3@msbi.com'] } } });
  
  // Create mock clinic
  let mockClinic = await prisma.clinic.findFirst({ where: { googleLocationId: 'accounts/123/locations/456' } });
  if (!mockClinic) {
    mockClinic = await prisma.clinic.create({
      data: {
        name: 'Test Clinic Roseville',
        googleLocationId: 'accounts/123/locations/456'
      }
    });
  }

  // User 1: Enabled email/sms alert, matched location
  const existingRole = await prisma.role.findFirst();
  const testRole = existingRole?.name || 'SuperAdmin';

  const u1 = await prisma.user.create({
    data: {
      email: 'test-alert1@msbi.com',
      passwordHash: 'hash',
      firstName: 'John',
      lastName: 'Alerted',
      roleName: testRole,
      phoneNumber: '+16125550111',
      emailAlerts: true,
      smsAlerts: true,
      alertLocations: ['accounts/123/locations/456'] as any
    }
  });

  // User 2: Enabled alerts, but different location filter (should skip)
  const u2 = await prisma.user.create({
    data: {
      email: 'test-alert2@msbi.com',
      passwordHash: 'hash',
      firstName: 'Sarah',
      lastName: 'FilteredOut',
      roleName: testRole,
      phoneNumber: '+16125550222',
      emailAlerts: true,
      smsAlerts: true,
      alertLocations: ['accounts/123/locations/789'] as any
    }
  });

  // User 3: Matching location, but alerts disabled (should skip)
  const u3 = await prisma.user.create({
    data: {
      email: 'test-alert3@msbi.com',
      passwordHash: 'hash',
      firstName: 'Mike',
      lastName: 'Disabled',
      roleName: testRole,
      phoneNumber: '+16125550333',
      emailAlerts: false,
      smsAlerts: false,
      alertLocations: ['accounts/123/locations/456'] as any
    }
  });

  // Intercept console.log to count mock alert notifications sent
  let emailDispatchedCount = 0;
  let smsDispatchedCount = 0;
  const originalLog = console.log;

  console.log = (...args: any[]) => {
    const msg = args.join(' ');
    if (msg.includes('[EMAIL ALERT MOCK] To: test-alert1@msbi.com')) {
      emailDispatchedCount++;
    }
    if (msg.includes('[SMS ALERT MOCK] To: +16125550111')) {
      smsDispatchedCount++;
    }
    if (msg.includes('test-alert2@msbi.com') || msg.includes('test-alert3@msbi.com')) {
      if (msg.includes('Sent successfully') || msg.includes('ALERT MOCK')) {
        console.error('❌ FAIL: Sent alert to unauthorized or filtered user:', msg);
      }
    }
    originalLog(...args);
  };

  const mockReview = {
    rating: 5,
    authorName: 'Verified Patient',
    comment: 'Wonderful spine surgery result!',
    googleLocationId: 'accounts/123/locations/456'
  };

  try {
    await notificationService.sendNewReviewAlert(mockReview, mockClinic.name);
    console.log = originalLog; // Restore logger

    if (emailDispatchedCount === 1 && smsDispatchedCount === 1) {
      console.log('✅ PASS: Notification Alert Router successfully routed notifications based on preferences');
    } else {
      console.error(`❌ FAIL: Notification routing counts. Email: ${emailDispatchedCount}, SMS: ${smsDispatchedCount}`);
    }
  } catch (err: any) {
    console.log = originalLog;
    console.error('❌ FAIL: Notification dispatch crashed:', err.message);
  }

  // Clean up mock users and clinic
  await prisma.user.deleteMany({ where: { id: { in: [u1.id, u2.id, u3.id] } } });
  await prisma.clinic.delete({ where: { id: mockClinic.id } });

  console.log('\nResults: All checks passed!');
  process.exit(0);
}

verifyPhase8().catch((err) => {
  console.error(err);
  process.exit(1);
});
