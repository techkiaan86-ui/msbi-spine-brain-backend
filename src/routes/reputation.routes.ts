import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { 
  getReviewsHandler, 
  sendReviewRequestHandler,
  getClinicRatingsHandler,
  getProviderRatingsHandler,
  createReviewHandler,
  getGbpAccountsHandler,
  getGbpLocationsHandler,
  getMappingsHandler,
  saveMappingsHandler,
  replyToReviewHandler,
  syncGbpReviewsHandler
} from '../controllers/reputation.controller';
import { createReviewRequestSchema, createReviewSchema } from '../validators/reputation.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function reputationRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  // Protected application routes requiring 'reputation' permission
  const rbacReputation = [authorize('reputation')];

  server.get('/reviews', { preHandler: rbacReputation }, getReviewsHandler);
  server.get('/clinics', { preHandler: rbacReputation }, getClinicRatingsHandler);
  server.get('/providers', { preHandler: rbacReputation }, getProviderRatingsHandler);

  server.get('/gbp/accounts', { preHandler: rbacReputation }, getGbpAccountsHandler);
  server.get('/gbp/locations', { preHandler: rbacReputation }, getGbpLocationsHandler);
  server.get('/mappings', { preHandler: rbacReputation }, getMappingsHandler);
  server.post('/mappings', { preHandler: rbacReputation }, saveMappingsHandler);
  server.post('/reviews/:id/reply', { preHandler: rbacReputation }, replyToReviewHandler);
  server.post('/sync', { preHandler: rbacReputation }, syncGbpReviewsHandler);

  server.post(
    '/requests',
    {
      preHandler: rbacReputation,
      schema: {
        body: createReviewRequestSchema,
      },
    },
    sendReviewRequestHandler
  );

  // Inbound Review Submission Webhook (guarded by x-webhook-secret header check in handler)
  server.post(
    '/reviews',
    {
      schema: {
        body: createReviewSchema,
      },
    },
    createReviewHandler
  );
}
