// @ts-nocheck
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { hubspotService } from './src/services/hubspot.service';
import { mailchimpService } from './src/services/mailchimp.service';
import axios from 'axios';

async function run() {
  console.log("--- Starting Phase 5 Verification ---");
  
  // 1. Setup Mock Integration Credentials
  await prisma.integrationCredential.upsert({
    where: { platformName: 'hubspot' },
    update: {
      isActive: true,
      accessToken: 'mock-hubspot-token'
    },
    create: {
      platformName: 'hubspot',
      isActive: true,
      accessToken: 'mock-hubspot-token'
    }
  });

  await prisma.integrationCredential.upsert({
    where: { platformName: 'mailchimp' },
    update: {
      isActive: true,
      apiKey: 'mock-mailchimp-key',
      config: { serverPrefix: 'us1', audienceId: 'mock-audience-id' }
    },
    create: {
      platformName: 'mailchimp',
      isActive: true,
      apiKey: 'mock-mailchimp-key',
      config: { serverPrefix: 'us1', audienceId: 'mock-audience-id' }
    }
  });

  // 2. Mock API responses
  const mockGet = async (url: string) => {
    if (url.includes('api.hubapi.com') || url.includes('/crm/v3/objects/contacts')) {
      return {
        data: {
          results: [
            {
              id: 'hub-001',
              properties: {
                firstname: 'John',
                lastname: 'Doe',
                email: 'john@example.com',
                phone: '555-1234',
                lifecyclestage: 'lead',
                hs_analytics_source: 'ORGANIC_SEARCH'
              }
            },
            {
              id: 'hub-002',
              properties: {
                firstname: 'Jane',
                lastname: 'Smith',
                email: 'jane@example.com',
                lifecyclestage: 'customer',
                hs_analytics_source: 'PAID_SOCIAL'
              }
            }
          ]
        }
      };
    }
    
    if (url.includes('campaigns') || url.includes('/campaigns?')) {
      return {
        data: {
          campaigns: [
            {
              id: 'mc-camp-001',
              status: 'sent',
              emails_sent: 1000,
              send_time: new Date().toISOString(),
              settings: { title: 'August Newsletter' }
            },
            {
              id: 'mc-camp-002',
              status: 'draft',
              emails_sent: 0,
              settings: { title: 'September Promo' } // Should be skipped
            }
          ]
        }
      };
    }

    if (url.includes('reports/mc-camp-001')) {
      return {
        data: {
          opens: { opens_total: 450, open_rate: 0.45 },
          clicks: { clicks_total: 100, click_rate: 0.10 },
          unsubscribed: 5,
          bounces: { hard_bounces: 2, soft_bounces: 1 }
        }
      };
    }
    
    throw new Error('Unknown mock URL: ' + url);
  };

  (axios as any).create = () => {
    return {
      get: mockGet
    };
  };

  try {
    // 3. Run HubSpot Sync
    console.log("\\nTesting HubSpot Lead Sync...");
    const hsResult = await hubspotService.syncLeads();
    console.log("HubSpot Sync Result:", hsResult);
    
    // Check DB
    const leads = await prisma.lead.findMany({ where: { leadPlatform: 'hubspot' } });
    console.log(`Found ${leads.length} HubSpot Leads in DB.`);
    if (leads.length < 2) throw new Error("Expected at least 2 leads to be synced.");
    const orgLead = leads.find(l => l.externalLeadId === 'hub-001');
    if (!orgLead || orgLead.source !== 'ORGANIC_SEARCH') throw new Error("Lead source mapping failed.");
    
    // Ensure idempotency
    await hubspotService.syncLeads();
    const leads2 = await prisma.lead.findMany({ where: { leadPlatform: 'hubspot' } });
    if (leads2.length !== leads.length) throw new Error("Duplicate leads created on second sync!");
    console.log("HubSpot idempotency check passed.");

    // 4. Run Mailchimp Sync
    console.log("\\nTesting Mailchimp Campaign Sync...");
    const mcResult = await mailchimpService.syncCampaigns();
    console.log("Mailchimp Sync Result:", mcResult);
    
    // Check DB
    const campaigns = await prisma.campaign.findMany({ where: { platform: 'mailchimp' } });
    console.log(`Found ${campaigns.length} Mailchimp Campaigns in DB.`);
    if (campaigns.length !== 1) throw new Error("Expected exactly 1 sent campaign to be synced.");
    
    const mcMetrics = await prisma.emailCampaignMetric.findUnique({
      where: { campaignId: campaigns[0].id }
    });
    console.log("Mailchimp Metrics:", mcMetrics);
    if (!mcMetrics) throw new Error("Email metrics not created!");
    if (mcMetrics.opens !== 450 || mcMetrics.bounces !== 3) throw new Error("Metric mapping failed.");
    
    // Ensure idempotency
    await mailchimpService.syncCampaigns();
    const campaigns2 = await prisma.campaign.findMany({ where: { platform: 'mailchimp' } });
    if (campaigns2.length !== campaigns.length) throw new Error("Duplicate campaigns created on second sync!");
    console.log("Mailchimp idempotency check passed.");
    
    console.log("\\n=== Phase 5 Verification Passed! ===");
  } catch (err) {
    console.error("Verification failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
