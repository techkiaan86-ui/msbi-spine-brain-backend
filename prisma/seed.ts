import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.attributionData.deleteMany();
  await prisma.landingPageMetric.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.campaignTask.deleteMany();
  await prisma.campaignAsset.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.reviewRequest.deleteMany();
  await prisma.review.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.clinic.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.vendorContact.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.analyticsSnapshot.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.department.deleteMany();
  await prisma.organization.deleteMany();

  // 1. Organization & Departments
  await prisma.organization.create({
    data: { name: 'MSBI Health', timezone: 'EST', currency: 'USD' }
  });

  const deptMarketing = await prisma.department.create({ data: { name: 'Marketing' } });
  const deptClinical = await prisma.department.create({ data: { name: 'Clinical' } });

  // 2. Roles
  const navKeys = ['dashboard', 'analytics', 'campaigns', 'budget', 'reputation', 'vendors', 'reports', 'integrations', 'users-roles', 'settings'];
  const generateDefaultPermissions = (isAdmin: boolean) => {
    const perms: any = {};
    navKeys.forEach(key => { perms[key] = isAdmin; });
    return perms;
  };

  const adminRole = await prisma.role.create({
    data: { name: 'Admin', isSystem: true, permissions: generateDefaultPermissions(true) }
  });
  const managerRole = await prisma.role.create({
    data: { name: 'Manager', isSystem: true, permissions: { ...generateDefaultPermissions(false), dashboard: true, analytics: true, campaigns: true, reputation: true, vendors: true, reports: true } }
  });
  const specialistRole = await prisma.role.create({
    data: { name: 'Specialist', isSystem: true, permissions: { ...generateDefaultPermissions(false), dashboard: true, analytics: true, campaigns: true, reputation: true, reports: true } }
  });
  const clinicalRole = await prisma.role.create({
    data: { name: 'Clinical Lead', isSystem: true, permissions: { ...generateDefaultPermissions(false), dashboard: true, analytics: true, reputation: true, reports: true } }
  });

  // 3. Users
  const passwordHash = await bcrypt.hash('password123', 10);
  
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@msbi.com',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      roleName: 'Admin',
      departmentId: deptMarketing.id
    }
  });

  const managerUser = await prisma.user.create({
    data: {
      email: 'manager@msbi.com',
      passwordHash,
      firstName: 'Marketing',
      lastName: 'Manager',
      roleName: 'Manager',
      departmentId: deptMarketing.id
    }
  });

  const specialistUser = await prisma.user.create({
    data: {
      email: 'specialist@msbi.com',
      passwordHash,
      firstName: 'Marketing',
      lastName: 'Specialist',
      roleName: 'Specialist',
      departmentId: deptMarketing.id
    }
  });

  const clinicalUser = await prisma.user.create({
    data: {
      email: 'clinical@msbi.com',
      passwordHash,
      firstName: 'Clinical',
      lastName: 'Lead',
      roleName: 'Clinical Lead',
      departmentId: deptClinical.id
    }
  });

  // 3. Analytics Snapshot
  await prisma.analyticsSnapshot.create({
    data: {
      date: new Date(),
      websiteVisitors: 45200,
      leads: 1250,
      calls: 890,
      formSubmissions: 360,
      conversionRate: 2.8,
      roi: 312.5,
      spend: 45000.00
    }
  });

  // 4. Campaigns
  await prisma.campaign.create({
    data: {
      name: 'Spine Health Q3 Push',
      status: 'Active',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-09-30'),
      budget: 15000.00,
      spend: 9450.00,
      revenue: 72000.00,
      goal: 'Generate 400 Leads',
      ownerId: adminUser.id
    }
  });

  await prisma.campaign.create({
    data: {
      name: 'Neurology Consult Drive',
      status: 'Draft',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-10-31'),
      budget: 5000.00,
      spend: 4200.00,
      revenue: 18500.00,
      goal: 'Generate 200 Leads',
      ownerId: managerUser.id
    }
  });

  // 5. Budget & Expenses
  const budget = await prisma.budget.create({
    data: {
      year: 2026,
      month: 8,
      totalPlanned: 50000.00,
      totalActual: 24500.00
    }
  });

  // 6. Vendors
  const vendor = await prisma.vendor.create({
    data: {
      name: 'Google Ads',
      category: 'Digital Marketing',
      performanceScore: 9.5
    }
  });

  await prisma.expense.create({
    data: {
      budgetId: budget.id,
      category: 'PPC',
      amount: 4500.00,
      vendorId: vendor.id,
      date: new Date()
    }
  });

  // 7. Landing Page Metrics
  await prisma.landingPageMetric.createMany({
    data: [
      { path: '/spine-surgery-minimally-invasive', pageviews: 12400, uniqueVisitors: 9800, bounceRate: 32.1, conversions: 184 },
      { path: '/brain-tumor-neurosurgery-consult', pageviews: 8200, uniqueVisitors: 6400, bounceRate: 35.4, conversions: 112 },
      { path: '/sciatica-back-pain-relief', pageviews: 6100, uniqueVisitors: 4900, bounceRate: 41.0, conversions: 92 },
    ]
  });

  // 9. Campaign Tasks & Assets
  const spineCampaign = await prisma.campaign.findFirst({ where: { name: 'Spine Health Q3 Push' } });
  if (spineCampaign) {
    await prisma.campaignTask.createMany({
      data: [
        { campaignId: spineCampaign.id, title: 'Finalize Spine Surgery TV Spot', status: 'To Do', assignedTo: 'Sarah Jenkins' },
        { campaignId: spineCampaign.id, title: 'Upload Meta Retargeting Pixel', status: 'To Do', assignedTo: 'Digital Media Team' },
        { campaignId: spineCampaign.id, title: 'Budget Allocations Audit', status: 'Completed', assignedTo: 'Dr. Vance' }
      ]
    });

    await prisma.campaignAsset.createMany({
      data: [
        { campaignId: spineCampaign.id, name: 'Spine_Surgery_Brochure.pdf', fileType: 'PDF Document', fileSize: '4.2 MB', fileUrl: '/storage/assets/Spine_Surgery_Brochure.pdf', mimeType: 'application/pdf' },
        { campaignId: spineCampaign.id, name: 'Minimally_Invasive_Ad_1080x1080.png', fileType: 'Graphic Asset', fileSize: '1.8 MB', fileUrl: '/storage/assets/Minimally_Invasive_Ad_1080x1080.png', mimeType: 'image/png' },
        { campaignId: spineCampaign.id, name: 'Doctor_Consult_Video.mp4', fileType: 'Video Asset', fileSize: '24.5 MB', fileUrl: '/storage/assets/Doctor_Consult_Video.mp4', mimeType: 'video/mp4' }
      ]
    });
  }

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
