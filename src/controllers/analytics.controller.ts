import { FastifyRequest, FastifyReply } from 'fastify';
import { analyticsService } from '../services/analytics.service';
import { AnalyticsQuery } from '../validators/analytics.schema';

export const getAnalyticsOverviewHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  try {
    const data = await analyticsService.getOverview(request.query);
    return reply.send({ success: true, data });
  } catch (error: any) {
    return reply.status(400).send({ success: false, error: error.message || 'Failed to fetch analytics overview' });
  }
};

export const getWebsiteAnalyticsHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  try {
    const data = await analyticsService.getWebsiteAnalytics(request.query);
    return reply.send({ success: true, data });
  } catch (error: any) {
    return reply.status(400).send({ success: false, error: error.message || 'Failed to fetch website analytics' });
  }
};



export const getLeadsAnalyticsHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  const data = await analyticsService.getLeadsAnalytics(request.query);
  return reply.send({ success: true, data });
};

export const getCallsAnalyticsHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  const data = await analyticsService.getCallsAnalytics(request.query);
  return reply.send({ success: true, data });
};

export const getRoiAnalyticsHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  const data = await analyticsService.getRoiAnalytics(request.query);
  return reply.send({ success: true, data });
};

export const getCampaignsPerformanceHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  const data = await analyticsService.getCampaignsPerformance(request.query);
  return reply.send({ success: true, data });
};

export const getAttributionHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  const data = await analyticsService.getAttribution(request.query);
  return reply.send({ success: true, data });
};

export const getEmailMarketingAnalyticsHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  const result = await analyticsService.getEmailMarketing(request.query);
  return reply.send({ success: true, ...result });
};

export const getTimeSeriesHandler = async (
  request: FastifyRequest<{ Querystring: AnalyticsQuery }>,
  reply: FastifyReply
) => {
  try {
    const data = await analyticsService.getTimeSeries(request.query);
    return reply.send({ success: true, data });
  } catch (error: any) {
    return reply.status(400).send({ success: false, error: error.message || 'Failed to fetch time series' });
  }
};
