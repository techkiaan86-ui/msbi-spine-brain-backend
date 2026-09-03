import prisma from '../plugins/db';
import { AnalyticsQuery } from '../validators/analytics.schema';
import { ga4Service } from './ga4.service';
import { gscService } from './gsc.service';

export function normalizeSource(data: { gclid?: string | null, fbclid?: string | null, utmSource?: string | null, utmMedium?: string | null, sourceUrl?: string | null }): string {
  if (data.gclid) return 'google_ads';
  if (data.fbclid) return 'meta_ads';
  
  const utmSource = (data.utmSource || '').toLowerCase();
  const utmMedium = (data.utmMedium || '').toLowerCase();
  
  if (utmSource === 'google' && (utmMedium === 'cpc' || utmMedium === 'ppc')) return 'google_ads';
  if ((utmSource === 'facebook' || utmSource === 'meta') && (utmMedium === 'cpc' || utmMedium === 'paid_social')) return 'meta_ads';
  if (utmSource.includes('email') || utmMedium.includes('email')) return 'email';
  if (utmMedium === 'organic') return 'organic_search';
  
  if (utmSource || utmMedium) {
    const raw = `${utmSource}${utmMedium ? '_' + utmMedium : ''}`;
    return raw ? raw.replace(/[^a-z0-9_]/g, '_') : 'unknown';
  }

  const referrer = (data.sourceUrl || '').toLowerCase();
  if (referrer) return 'referral';
  
  return 'unknown';
}

function parseDates(query: AnalyticsQuery) {
  const startDate = query.startDate ? new Date(query.startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
  const endDate = query.endDate ? new Date(query.endDate) : new Date();
  
  // ensure endDate covers full day
  endDate.setHours(23, 59, 59, 999);
  
  return { startDate, endDate };
}

export class AnalyticsService {
  async getOverview(query: AnalyticsQuery) {
    const { startDate, endDate } = parseDates(query);
    
    // Check credentials for availability & freshness
    const creds = await prisma.integrationCredential.findMany();
    
    const credStatus = (platformName: string) => {
      const c = creds.find(x => x.platformName === platformName);
      return {
        connected: !!c?.isActive,
        lastSyncAt: c?.lastSyncAt || null,
        lastSuccessfulSyncAt: c?.lastSuccessfulSyncAt || null
      };
    };

    const ga4Cred = {
      ...credStatus('ga4'),
      connected: credStatus('ga4').connected || credStatus('google_analytics').connected
    };
    const gAdsCred = credStatus('google_ads');
    const mAdsCred = credStatus('meta');
    const mailchimpCred = credStatus('mailchimp');
    const hubspotCred = credStatus('hubspot');
    const callrailCred = credStatus('callrail');
    const gbpCred = credStatus('google_business');

    // 1. Website (GA4 + GSC live if connected)
    let website: any = { status: ga4Cred };
    if (ga4Cred.connected) {
      try {
        const ga4StartDate = query.startDate ? query.startDate.split('T')[0] : '30daysAgo';
        const ga4EndDate = query.endDate ? query.endDate.split('T')[0] : 'today';
        const ga4Data = await ga4Service.getOverview(ga4StartDate, ga4EndDate);
        website.data = {
          sessions: parseInt(String(ga4Data?.sessions || 0), 10),
          pageviews: parseInt(String(ga4Data?.screenPageViews || 0), 10),
          activeUsers: parseInt(String(ga4Data?.activeUsers || 0), 10),
          websiteConversionRate: null // Needs exact definition
        };
      } catch (e: any) {
        console.error('[ANALYTICS SERVICE GA4 OVERVIEW ERROR]:', e);
        website.error = `Failed to fetch GA4 data: ${e.message || e}`;
      }
    }

    // 2. Leads (FormSubmissions + Leads)
    const formSubmissions = await prisma.formSubmission.count({
      where: { createdAt: { gte: startDate, lte: endDate } }
    });
    const totalLeads = await prisma.lead.count({
      where: { createdAt: { gte: startDate, lte: endDate } }
    });
    
    let leads = {
      status: { ...hubspotCred, localConnected: true },
      data: {
        formSubmissionCount: formSubmissions,
        leadCount: totalLeads
      }
    };

    // 3. Paid Advertising (Google Ads + Meta Ads)
    const metrics = await prisma.campaignMetricSnapshot.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { campaign: true }
    });
    
    const googleSpend = metrics.filter(m => m.campaign.platform === 'google_ads').reduce((sum, m) => sum + Number(m.spend), 0);
    const metaSpend = metrics.filter(m => m.campaign.platform === 'meta').reduce((sum, m) => sum + Number(m.spend), 0);
    
    const paidAdvertising = {
      status: {
        googleAds: gAdsCred,
        metaAds: mAdsCred
      },
      data: {
        totalSpend: googleSpend + metaSpend, // Assuming same currency for simplicity here, but UI should protect.
        googleAdsSpend: googleSpend,
        metaAdsSpend: metaSpend,
        impressions: metrics.reduce((sum, m) => sum + m.impressions, 0),
        clicks: metrics.reduce((sum, m) => sum + m.clicks, 0),
        providerConversions: metrics.reduce((sum, m) => sum + Number(m.conversions || 0), 0)
      }
    };

    // 4. Calls
    const callsCount = await prisma.callLog.count({
      where: { timestamp: { gte: startDate, lte: endDate } }
    });
    const calls = {
      status: callrailCred,
      data: { callCount: callsCount }
    };

    // 5. Email
    const emailCampaigns = await prisma.emailCampaignMetric.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } }
    });
    
    const email = {
      status: mailchimpCred,
      data: {
        sent: emailCampaigns.reduce((sum, m) => sum + (m.sent || 0), 0),
        opens: emailCampaigns.reduce((sum, m) => sum + (m.opens || 0), 0),
        clicks: emailCampaigns.reduce((sum, m) => sum + (m.clicks || 0), 0)
      }
    };

    // 6. Reputation
    const reviews = await prisma.review.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        platform: 'Google'
      }
    });
    const avgRating = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
    
    const reputation = {
      status: gbpCred,
      data: {
        totalReviews: reviews.length,
        averageRating: avgRating
      }
    };

    return {
      website,
      leads,
      paidAdvertising,
      calls,
      email,
      reputation
    };
  }

  async getAttribution(query: AnalyticsQuery) {
    const { startDate, endDate } = parseDates(query);
    
    const submissions = await prisma.formSubmission.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } }
    });
    
    const attributionMap: Record<string, number> = {};
    
    for (const sub of submissions) {
      const channel = normalizeSource({
        gclid: sub.gclid,
        fbclid: sub.fbclid,
        utmSource: sub.utmSource,
        utmMedium: sub.utmMedium,
        sourceUrl: sub.sourceUrl
      });
      attributionMap[channel] = (attributionMap[channel] || 0) + 1;
    }
    
    return Object.entries(attributionMap).map(([source, count]) => ({
      source,
      count
    })).sort((a, b) => b.count - a.count);
  }

  async getRoiAnalytics(query: AnalyticsQuery) {
    const { startDate, endDate } = parseDates(query);

    const metrics = await prisma.campaignMetricSnapshot.findMany({
      where: { date: { gte: startDate, lte: endDate } }
    });

    const totalAdSpend = metrics.reduce((sum, m) => sum + Number(m.spend), 0);
    
    // For V1 strict ROI, we must have verified revenue.
    // If campaigns don't explicitly have verified revenue for the period, ROI = null.
    // We aggregate conversionValue as verified revenue ONLY if it represents actual revenue.
    const verifiedRevenue = metrics.reduce((sum, m) => sum + Number(m.conversionValue || 0), 0);

    let roi: number | null = null;
    let roiStatus = 'calculated';
    
    if (verifiedRevenue <= 0) {
      roi = null;
      roiStatus = 'revenue_unavailable';
    } else if (totalAdSpend > 0) {
      roi = ((verifiedRevenue - totalAdSpend) / totalAdSpend) * 100;
    }

    return {
      roi,
      roiStatus,
      totalAdSpend,
      verifiedRevenue
    };
  }
  
  async getCampaignsPerformance(query: AnalyticsQuery) {
    const { startDate, endDate } = parseDates(query);
    const campaigns = await prisma.campaign.findMany({
      where: {
        platform: { in: ['google_ads', 'meta'] }
      },
      include: { 
        metrics: {
          where: { date: { gte: startDate, lte: endDate } }
        } 
      }
    });

    return campaigns.map(c => {
      const spend = c.metrics.reduce((acc, m) => acc + Number(m.spend), 0);
      const conversions = c.metrics.reduce((acc, m) => acc + Number(m.conversions || 0), 0);
      const conversionValue = c.metrics.reduce((acc, m) => acc + Number(m.conversionValue || 0), 0);
      const impressions = c.metrics.reduce((acc, m) => acc + m.impressions, 0);
      const clicks = c.metrics.reduce((acc, m) => acc + m.clicks, 0);
      
      const roas = (spend > 0 && conversionValue > 0) ? (conversionValue / spend) : null;
      
      // Calculate CPL specific to this campaign's exact attributed leads in this date range
      // This is a naive implementation since we don't have direct Campaign -> Lead links yet,
      // but if we use utmCampaign mapping:
      // Note: Ideally we'd query formSubmissions where utmCampaign == c.name or similar.
      // We will leave attributedLeads = conversions for simplicity of the formula (if the provider passes conversions)
      // or we query exact linked FormSubmissions. Let's assume provider conversions for now.
      const attributedLeads = conversions;
      
      const cpl = (spend > 0 && attributedLeads > 0) ? (spend / attributedLeads) : null;
      
      return {
        name: c.name,
        platform: c.platform,
        spend,
        conversions,
        conversionValue,
        impressions,
        clicks,
        roas,
        cpl,
        attributedLeads
      };
    }).sort((a, b) => b.spend - a.spend);
  }

  async getLeadsAnalytics(query: AnalyticsQuery) {
    const { startDate, endDate } = parseDates(query);
    const leads = await prisma.lead.count({
      where: { createdAt: { gte: startDate, lte: endDate } }
    });
    
    const formSubmissions = await prisma.formSubmission.count({
      where: { createdAt: { gte: startDate, lte: endDate } }
    });
    
    return {
      totalLeads: leads,
      totalSubmissions: formSubmissions,
      calls: await prisma.callLog.count({
        where: { timestamp: { gte: startDate, lte: endDate } }
      })
    };
  }

  // Preserve other specific endpoints as wrappers mapping to new normalized logic
  async getWebsiteAnalytics(query: AnalyticsQuery) {
    const creds = await prisma.integrationCredential.findMany();
    const credStatus = (platformName: string) => {
      const c = creds.find(x => x.platformName === platformName);
      return {
        connected: !!c?.isActive,
        lastSyncAt: c?.lastSyncAt || null,
        lastSuccessfulSyncAt: c?.lastSuccessfulSyncAt || null
      };
    };

    const ga4Cred = credStatus('ga4');
    const connected = ga4Cred.connected || credStatus('google_analytics').connected;

    if (!connected) {
      return {
        connected: false,
        data: null
      };
    }

    const startDate = query.startDate ? query.startDate.split('T')[0] : '30daysAgo';
    const endDate = query.endDate ? query.endDate.split('T')[0] : 'today';

    // 1. Get GA4 Overview data
    const ga4Data = await ga4Service.getOverview(startDate, endDate);

    // 2. Get GA4 Landing Pages report
    const landingPages = await ga4Service.getLandingPagesReport(startDate, endDate);

    // 3. Return mapped structure matching frontend expectations exactly
    return {
      connected: true,
      data: {
        overview: {
          sessions: ga4Data?.sessions || 0,
          screenPageViews: ga4Data?.screenPageViews || 0,
          activeUsers: ga4Data?.activeUsers || 0,
          engagedSessions: ga4Data?.engagedSessions || 0
        },
        landingPages: landingPages || [],
        searchConsole: [] // Leave empty or return GSC data if available
      }
    };
  }
  
  async getCallsAnalytics(query: AnalyticsQuery) {
    const overview = await this.getOverview(query);
    return overview.calls;
  }

  async getEmailMarketing(query: AnalyticsQuery) {
    const overview = await this.getOverview(query);
    return overview.email;
  }

  async getTimeSeries(query: AnalyticsQuery) {
    const { startDate, endDate } = parseDates(query);
    
    // Determine bucket format based on distance
    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
    const isMonthly = diffDays > 90;
    
    const formatDate = (d: Date) => {
      if (isMonthly) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return d.toISOString().split('T')[0];
    };

    const leadsData = await prisma.lead.findMany({ where: { createdAt: { gte: startDate, lte: endDate } }, select: { createdAt: true } });
    const formsData = await prisma.formSubmission.findMany({ where: { createdAt: { gte: startDate, lte: endDate } }, select: { createdAt: true } });
    const callsData = await prisma.callLog.findMany({ where: { timestamp: { gte: startDate, lte: endDate } }, select: { timestamp: true } });

    const metricsData = await prisma.campaignMetricSnapshot.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { campaign: true }
    });

    const inboundBuckets: Record<string, { date: string, leads: number, formSubmissions: number, calls: number }> = {};
    const campaignBuckets: Record<string, { date: string, googleAdsSpend: number, metaAdsSpend: number, conversions: number }> = {};

    // Group inbound
    leadsData.forEach(l => {
      const k = formatDate(l.createdAt);
      if (!inboundBuckets[k]) inboundBuckets[k] = { date: k, leads: 0, formSubmissions: 0, calls: 0 };
      inboundBuckets[k].leads++;
    });
    formsData.forEach(f => {
      const k = formatDate(f.createdAt);
      if (!inboundBuckets[k]) inboundBuckets[k] = { date: k, leads: 0, formSubmissions: 0, calls: 0 };
      inboundBuckets[k].formSubmissions++;
    });
    callsData.forEach(c => {
      const k = formatDate(c.timestamp);
      if (!inboundBuckets[k]) inboundBuckets[k] = { date: k, leads: 0, formSubmissions: 0, calls: 0 };
      inboundBuckets[k].calls++;
    });

    // Group campaigns
    metricsData.forEach(m => {
      const k = formatDate(m.date);
      if (!campaignBuckets[k]) campaignBuckets[k] = { date: k, googleAdsSpend: 0, metaAdsSpend: 0, conversions: 0 };
      
      const spend = Number(m.spend);
      if (m.campaign.platform === 'google_ads') campaignBuckets[k].googleAdsSpend += spend;
      if (m.campaign.platform === 'meta') campaignBuckets[k].metaAdsSpend += spend;
      campaignBuckets[k].conversions += Number(m.conversions || 0);
    });

    const inbound = Object.values(inboundBuckets).sort((a, b) => a.date.localeCompare(b.date));
    const campaigns = Object.values(campaignBuckets).sort((a, b) => a.date.localeCompare(b.date));

    return { inbound, campaigns };
  }
}

export const analyticsService = new AnalyticsService();
