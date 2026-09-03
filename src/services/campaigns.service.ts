import prisma from '../plugins/db';
import { CreateCampaignInput, UpdateCampaignInput, CreateTaskInput } from '../validators/campaigns.schema';

export class CampaignsService {
  async getAllCampaigns(statusFilter?: string) {
    const whereClause = statusFilter ? { status: statusFilter } : {};
    const campaigns = await prisma.campaign.findMany({
      where: whereClause,
      include: {
        owner: { select: { firstName: true, lastName: true } },
        metrics: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return campaigns.map(c => {
      let aggregatedSpend = Number(c.spend);
      let aggregatedRevenue = Number(c.revenue);
      let totalConversions = 0;
      let totalImpressions = 0;
      let totalClicks = 0;

      if (c.metrics && c.metrics.length > 0) {
        const totalMetricSpend = c.metrics.reduce((acc, m) => acc + Number(m.spend), 0);
        const totalMetricRevenue = c.metrics.reduce((acc, m) => acc + Number(m.conversionValue || 0), 0);
        const totalMetricConversions = c.metrics.reduce((acc, m) => acc + Number(m.conversions || 0), 0);
        const totalMetricImpressions = c.metrics.reduce((acc, m) => acc + Number(m.impressions || 0), 0);
        const totalMetricClicks = c.metrics.reduce((acc, m) => acc + Number(m.clicks || 0), 0);
        
        aggregatedSpend += totalMetricSpend;
        aggregatedRevenue += totalMetricRevenue;
        totalConversions += totalMetricConversions;
        totalImpressions += totalMetricImpressions;
        totalClicks += totalMetricClicks;
      }

      let roi: number | null = null;
      if (aggregatedSpend > 0 && aggregatedRevenue > 0) {
        roi = ((aggregatedRevenue - aggregatedSpend) / aggregatedSpend) * 100;
      }

      const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const cpc = totalClicks > 0 ? aggregatedSpend / totalClicks : 0;

      return {
        ...c,
        spend: parseFloat(aggregatedSpend.toFixed(2)),
        revenue: parseFloat(aggregatedRevenue.toFixed(2)),
        leadsGenerated: totalConversions,
        impressions: totalImpressions,
        clicks: totalClicks,
        ctr: parseFloat(ctr.toFixed(2)),
        cpc: parseFloat(cpc.toFixed(2)),
        conversions: totalConversions,
        conversionValue: parseFloat(aggregatedRevenue.toFixed(2)),
        roi: roi ? roi.toFixed(2) : null,
      };
    });
  }

  async createCampaign(data: CreateCampaignInput) {
    return prisma.campaign.create({
      data: {
        name: data.name,
        status: data.status,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        budget: data.budget,
        goal: data.goal,
        ownerId: data.ownerId,
      },
    });
  }

  async getCampaignById(id: string) {
    return prisma.campaign.findUnique({
      where: { id },
      include: { tasks: true, assets: true },
    });
  }

  async updateCampaign(id: string, data: UpdateCampaignInput) {
    return prisma.campaign.update({
      where: { id },
      data,
    });
  }

  async getCampaignTasks(campaignId: string) {
    return prisma.campaignTask.findMany({
      where: { campaignId },
      orderBy: { dueDate: 'asc' }
    });
  }

  async addCampaignTask(campaignId: string, data: CreateTaskInput) {
    return prisma.campaignTask.create({
      data: {
        campaignId,
        title: data.title,
        status: data.status,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        assignedTo: data.assignedTo,
      }
    });
  }

  async upsertExternalCampaigns(campaigns: any[], metrics: any[]) {
    // We assume the caller (integrations controller) passes the array of external campaigns
    // and the array of metrics. We need to find or create the campaign locally and insert metrics.
    
    // Fallback owner if we don't know who owns the system integrations (get first admin)
    let adminUser = await prisma.user.findFirst({ where: { roleName: 'Admin' } });
    if (!adminUser) {
      adminUser = await prisma.user.findFirst();
    }
    const fallbackOwnerId = adminUser?.id || '';

    for (const c of campaigns) {
      const existing = await prisma.campaign.findFirst({
        where: { platform: c.platform, externalCampaignId: c.externalId }
      });

      let localCampaignId = existing?.id;

      if (!existing && fallbackOwnerId) {
        const created = await prisma.campaign.create({
          data: {
            name: c.name,
            status: c.status,
            startDate: c.startDate ? new Date(c.startDate) : new Date(),
            endDate: c.endDate ? new Date(c.endDate) : null,
            budget: 0,
            spend: 0,
            revenue: 0,
            ownerId: fallbackOwnerId,
            platform: c.platform,
            externalCampaignId: c.externalId,
            lastSyncedAt: new Date()
          }
        });
        localCampaignId = created.id;
      } else if (existing) {
        await prisma.campaign.update({
          where: { id: existing.id },
          data: {
            name: c.name,
            status: c.status,
            endDate: c.endDate ? new Date(c.endDate) : null,
            lastSyncedAt: new Date()
          }
        });
      }

      // Now upsert metrics for this specific campaign
      if (localCampaignId) {
        const campaignMetrics = metrics.filter(m => m.externalId === c.externalId);
        for (const m of campaignMetrics) {
          const mDate = new Date(m.date);
          await prisma.campaignMetricSnapshot.upsert({
            where: {
              campaignId_date: {
                campaignId: localCampaignId,
                date: mDate
              }
            },
            update: {
              impressions: m.impressions,
              clicks: m.clicks,
              spend: m.spend,
              conversions: m.conversions,
              conversionValue: m.conversionValue,
              currencyCode: m.currencyCode
            },
            create: {
              campaignId: localCampaignId,
              date: mDate,
              impressions: m.impressions,
              clicks: m.clicks,
              spend: m.spend,
              conversions: m.conversions,
              conversionValue: m.conversionValue,
              currencyCode: m.currencyCode
            }
          });
        }
      }
    }
  }
  async getAllTasks() {
    return prisma.campaignTask.findMany({
      include: { campaign: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateTaskStatus(taskId: string, status: string) {
    return prisma.campaignTask.update({
      where: { id: taskId },
      data: { status }
    });
  }

  async getAllAssets() {
    return prisma.campaignAsset.findMany({
      include: { campaign: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAssetById(id: string) {
    return prisma.campaignAsset.findUnique({
      where: { id }
    });
  }
}

export const campaignsService = new CampaignsService();
