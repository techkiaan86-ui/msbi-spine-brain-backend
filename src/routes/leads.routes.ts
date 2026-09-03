import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createLeadWebhookHandler, getLeadsHandler } from '../controllers/leads.controller';
import { createLeadSchema } from '../validators/leads.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function leadsRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  // Protected: View all patient leads (requires 'analytics' permission)
  server.get(
    '/',
    {
      preHandler: [authorize('analytics')]
    },
    getLeadsHandler
  );

  // Inbound Webhook endpoint for lead ingestion with rate limiting
  server.post(
    '/webhook',
    {
      schema: {
        body: createLeadSchema,
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      }
    },
    createLeadWebhookHandler
  );
}
