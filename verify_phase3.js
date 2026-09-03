const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { campaignsService } = require('./src/services/campaigns.service');
const { analyticsService } = require('./src/services/analytics.service');

async function runVerification() {
  console.log('--- STARTING PHASE 3 VERIFICATION ---');

  // MOCK DATA
  const mockGoogleCampaigns = [
    { platform: 'google_ads', externalId: 'g-101', name: 'Google Search - Spine', status: 'Active', startDate: new Date('2026-08-01') }
  ];
  const mockGoogleMetrics = [
    { externalId: 'g-101', date: new Date('2026-08-10'), impressions: 1500, clicks: 120, spend: 350.50, conversions: 12, conversionValue: 4500, currencyCode: 'USD' },
    { externalId: 'g-101', date: new Date('2026-08-11'), impressions: 1800, clicks: 145, spend: 400.00, conversions: 15, conversionValue: 6000, currencyCode: 'USD' }
  ];

  const mockMetaCampaigns = [
    { platform: 'meta_ads', externalId: 'm-202', name: 'Facebook Retargeting - Brain', status: 'Active', startDate: new Date('2026-08-05') }
  ];
  const mockMetaMetrics = [
    { externalId: 'm-202', date: new Date('2026-08-10'), impressions: 5000, clicks: 80, spend: 120.00, conversions: 5, conversionValue: 1200, currencyCode: 'USD' },
    { externalId: 'm-202', date: new Date('2026-08-11'), impressions: 6000, clicks: 95, spend: 150.00, conversions: 8, conversionValue: 2000, currencyCode: 'USD' }
  ];

  console.log('\n[1] Testing Upsert Logic (Google Ads & Meta Ads)...');
  await campaignsService.upsertExternalCampaigns(mockGoogleCampaigns, mockGoogleMetrics);
  await campaignsService.upsertExternalCampaigns(mockMetaCampaigns, mockMetaMetrics);
  console.log('Upsert completed without errors.');

  console.log('\n[2] Verifying Campaign Aggregation...');
  const campaigns = await campaignsService.getAllCampaigns();
  const googleCamp = campaigns.find(c => c.externalCampaignId === 'g-101');
  const metaCamp = campaigns.find(c => c.externalCampaignId === 'm-202');

  console.log(`Google Ads Sync Check: spend=${googleCamp?.spend}, revenue=${googleCamp?.revenue}, roi=${googleCamp?.roi}`);
  console.log(`Meta Ads Sync Check: spend=${metaCamp?.spend}, revenue=${metaCamp?.revenue}, roi=${metaCamp?.roi}`);

  if (googleCamp?.spend !== (350.50 + 400.00)) throw new Error('Google Spend Aggregation Failed');
  if (metaCamp?.spend !== (120.00 + 150.00)) throw new Error('Meta Spend Aggregation Failed');

  console.log('\n[3] Verifying True ROI Global Calculation...');
  // Force a date range that covers our mock data
  const roi = await analyticsService.getRoiAnalytics({
    startDate: '2026-08-01',
    endDate: '2026-08-15'
  });
  console.log('ROI Output:', roi);
  const expectedSpend = (350.50 + 400.00 + 120.00 + 150.00);
  const expectedRev = (4500 + 6000 + 1200 + 2000);
  
  if (roi.totalAdSpend !== expectedSpend) throw new Error(`ROI Spend Failed: expected ${expectedSpend}, got ${roi.totalAdSpend}`);
  if (roi.attributedRevenue !== expectedRev) throw new Error(`ROI Revenue Failed: expected ${expectedRev}, got ${roi.attributedRevenue}`);
  
  console.log('Global ROI Calculation successfully matches True ROI rules.');

  console.log('\n--- PHASE 3 VERIFICATION COMPLETE ---');
}

runVerification()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
