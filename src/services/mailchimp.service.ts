import axios from 'axios';
import prisma from '../plugins/db';
import { integrationsService } from './integrations.service';

export class MailchimpService {
  private async getClient() {
    const creds = await integrationsService.getSecureCredentials('mailchimp');
    if (!creds || !creds.apiKey || !creds.config?.serverPrefix) return null;
    return {
      client: axios.create({
        baseURL: `https://${creds.config.serverPrefix}.api.mailchimp.com/3.0`,
        headers: {
          Authorization: `Basic ${Buffer.from(`any:${creds.apiKey}`).toString('base64')}`,
          'Content-Type': 'application/json'
        }
      }),
      config: creds.config
    };
  }

  async getAudiences() {
    const data = await this.getClient();
    if (!data) throw new Error('Mailchimp is not configured or connected.');
    
    const response = await data.client.get('/lists');
    return response.data.lists.map((list: any) => ({
      id: list.id,
      name: list.name,
      memberCount: list.stats?.member_count || 0
    }));
  }

  async syncCampaigns() {
    const data = await this.getClient();
    if (!data) throw new Error('Mailchimp is not configured or connected.');
    
    // We only sync campaigns for the selected audience
    const audienceId = data.config.audienceId;
    if (!audienceId) throw new Error('No Mailchimp audience selected.');

    let adminUser = await prisma.user.findFirst({ where: { roleName: 'Admin' } });
    if (!adminUser) {
      adminUser = await prisma.user.findFirst();
    }
    const fallbackOwnerId = adminUser?.id || '';

    const response = await data.client.get(`/campaigns?list_id=${audienceId}&count=50`);
    const campaigns = response.data.campaigns || [];
    
    let syncedCount = 0;
    for (const mcCampaign of campaigns) {
      if (mcCampaign.status !== 'sent') continue; // Only track sent campaigns for metrics
      
      const externalId = mcCampaign.id;
      const sendTime = mcCampaign.send_time ? new Date(mcCampaign.send_time) : new Date();
      const emailsSent = mcCampaign.emails_sent || 0;
      
      // Upsert the core Campaign
      const campaign = await prisma.campaign.upsert({
        where: {
          platform_externalCampaignId: {
            platform: 'mailchimp',
            externalCampaignId: externalId
          }
        },
        update: {
          name: mcCampaign.settings?.title || mcCampaign.settings?.subject_line || 'Untitled',
          lastSyncedAt: new Date()
        },
        create: {
          name: mcCampaign.settings?.title || mcCampaign.settings?.subject_line || 'Untitled',
          status: 'Completed', // It's sent
          startDate: sendTime,
          budget: 0,
          spend: 0,
          revenue: 0,
          ownerId: fallbackOwnerId,
          platform: 'mailchimp',
          externalCampaignId: externalId,
          lastSyncedAt: new Date()
        }
      });
      
      // Get the detailed report metrics
      // Mailchimp summary report is at /reports/{campaign_id}
      let reportData: any = {};
      try {
        const reportResponse = await data.client.get(`/reports/${externalId}`);
        reportData = reportResponse.data || {};
      } catch (err) {
        // Fallback to top-level if report endpoint fails or is missing
      }

      const opens = reportData.opens?.opens_total ?? null;
      const clicks = reportData.clicks?.clicks_total ?? null;
      const openRate = reportData.opens?.open_rate ?? null;
      const clickRate = reportData.clicks?.click_rate ?? null;
      const unsubscribes = reportData.unsubscribed ?? null;
      const bounces = reportData.bounces?.hard_bounces !== undefined ? 
                      (reportData.bounces.hard_bounces + (reportData.bounces.soft_bounces || 0)) : null;

      // Upsert into EmailCampaignMetric
      await prisma.emailCampaignMetric.upsert({
        where: { campaignId: campaign.id },
        update: {
          sent: emailsSent,
          opens,
          clicks,
          openRate,
          clickRate,
          unsubscribes,
          bounces
        },
        create: {
          campaignId: campaign.id,
          sent: emailsSent,
          opens,
          clicks,
          openRate,
          clickRate,
          unsubscribes,
          bounces
        }
      });

      syncedCount++;
    }
    
    // Update sync time
    await prisma.integrationCredential.update({
      where: { platformName: 'mailchimp' },
      data: {
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastError: null
      }
    });

    return { success: true, count: syncedCount };
  }
}

export const mailchimpService = new MailchimpService();
