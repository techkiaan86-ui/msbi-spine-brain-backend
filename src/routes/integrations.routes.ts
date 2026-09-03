import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { 
  getIntegrationStatusHandler, 
  syncIntegrationHandler,
  getGa4PropertiesHandler,
  setGa4PropertyHandler,
  getGscSitesHandler,
  setGscSiteHandler,
  syncGoogleAdsHandler,
  syncMetaAdsHandler,
  syncGbpHandler,
  syncCallrailHandler,
  syncHubspotHandler,
  syncMailchimpHandler,
  checkWordPressHealthHandler,
  getWordPressPostsHandler,
  getWordPressPagesHandler,
  getWordPressMediaHandler,
  getWordPressCategoriesHandler,
  getWordPressTagsHandler,
  getWordPressTypesHandler,
  getWordPressTaxonomiesHandler,
  getWordPressConditionTreatmentsHandler,
  getGoogleAdsConfigHandler,
  setGoogleAdsConfigHandler,
  getGoogleAdsPerformanceHandler
} from '../controllers/integrations.controller';
import { syncIntegrationSchema } from '../validators/integrations.schema';
import { z } from 'zod';
import { authorize } from '../middlewares/rbac.middleware';

export async function integrationsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('integrations'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get('/status', getIntegrationStatusHandler);

  server.post(
    '/sync',
    {
      schema: {
        body: syncIntegrationSchema,
      },
    },
    syncIntegrationHandler
  );

  server.post('/google-ads/sync', syncGoogleAdsHandler);
  server.get('/google-ads/config', getGoogleAdsConfigHandler);
  server.get('/google-ads/performance', getGoogleAdsPerformanceHandler);
  server.post('/google-ads/config', {
    schema: {
      body: z.object({
        customerId: z.string().min(1),
        loginCustomerId: z.string().optional().nullable()
      })
    }
  }, setGoogleAdsConfigHandler);

  server.post('/meta-ads/sync', syncMetaAdsHandler);
  server.post('/google-business/sync', syncGbpHandler);
  server.post('/callrail/sync', syncCallrailHandler);
  server.post('/hubspot/sync', syncHubspotHandler);
  server.post('/mailchimp/sync', syncMailchimpHandler);

  server.get('/ga4/properties', getGa4PropertiesHandler);
  
  server.post('/ga4/property', {
    schema: {
      body: z.object({ propertyId: z.string() })
    }
  }, setGa4PropertyHandler);

  server.get('/gsc/sites', getGscSitesHandler);

  server.post('/gsc/site', {
    schema: {
      body: z.object({ siteUrl: z.string() })
    }
  }, setGscSiteHandler);

  // WordPress routes
  server.get('/wordpress/health', checkWordPressHealthHandler);
  server.get('/wordpress/posts', getWordPressPostsHandler);
  server.get('/wordpress/pages', getWordPressPagesHandler);
  server.get('/wordpress/media', getWordPressMediaHandler);
  server.get('/wordpress/categories', getWordPressCategoriesHandler);
  server.get('/wordpress/tags', getWordPressTagsHandler);
  server.get('/wordpress/types', getWordPressTypesHandler);
  server.get('/wordpress/taxonomies', getWordPressTaxonomiesHandler);
  server.get('/wordpress/condition-treatments', getWordPressConditionTreatmentsHandler);
}
