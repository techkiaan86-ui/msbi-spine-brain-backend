import prisma from '../plugins/db';
import { DashboardQuery } from '../validators/dashboard.schema';

import { analyticsService } from './analytics.service';

export class DashboardService {
  async getSummary(query: DashboardQuery) {
    let startDate: string | undefined;
    const endDate = new Date().toISOString();
    const now = new Date();
    
    if (query.timeframe === 'today') {
      now.setHours(0, 0, 0, 0);
      startDate = now.toISOString();
    } else if (query.timeframe === 'week') {
      now.setDate(now.getDate() - 7);
      startDate = now.toISOString();
    } else if (query.timeframe === 'month') {
      now.setDate(now.getDate() - 30);
      startDate = now.toISOString();
    } else if (query.timeframe === 'year') {
      now.setFullYear(now.getFullYear() - 1);
      startDate = now.toISOString();
    }
    
    const overview = await analyticsService.getOverview({ startDate, endDate });
    const timeSeries = await analyticsService.getTimeSeries({ startDate, endDate });
    
    // Convert unified analytics overview into dashboard summary structure
    const activeCampaigns = await prisma.campaign.count({
      where: { status: 'Active' }
    });

    return {
      websiteTraffic: overview.website.data?.sessions || 0,
      totalLeads: overview.leads.data.leadCount + overview.leads.data.formSubmissionCount,
      conversionRate: 0, // Should be calculated or left 0 if undefined
      activeCampaigns,
      totalSpend: overview.paidAdvertising.data.totalSpend,
      overallRating: overview.reputation.data.averageRating,
      totalReviews: overview.reputation.data.totalReviews,
      timeSeries
    };
  }
}

export const dashboardService = new DashboardService();
