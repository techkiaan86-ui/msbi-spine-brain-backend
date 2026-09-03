import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  getAnalyticsOverviewHandler,
  getWebsiteAnalyticsHandler,
  getLeadsAnalyticsHandler,
  getCallsAnalyticsHandler,
  getRoiAnalyticsHandler,
  getCampaignsPerformanceHandler,
  getAttributionHandler,
  getEmailMarketingAnalyticsHandler,
  getTimeSeriesHandler
} from '../controllers/analytics.controller';
import { analyticsQuerySchema } from '../validators/analytics.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function analyticsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('analytics'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  const schema = { querystring: analyticsQuerySchema };

  server.get('/overview', { schema }, getAnalyticsOverviewHandler);
  server.get('/website', { schema }, getWebsiteAnalyticsHandler);
  server.get('/leads', { schema }, getLeadsAnalyticsHandler);
  server.get('/calls', { schema }, getCallsAnalyticsHandler);
  server.get('/roi', { schema }, getRoiAnalyticsHandler);
  server.get('/campaigns-performance', { schema }, getCampaignsPerformanceHandler);
  server.get('/attribution', { schema }, getAttributionHandler);
  server.get('/email-marketing', { schema }, getEmailMarketingAnalyticsHandler);
  server.get('/time-series', { schema }, getTimeSeriesHandler);
}
