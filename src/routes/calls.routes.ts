import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createCallWebhookHandler, getCallsHandler } from '../controllers/calls.controller';
import { createCallLogSchema } from '../validators/calls.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function callsRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  // Protected: View call tracking logs and recordings (requires 'analytics' permission)
  server.get(
    '/',
    {
      preHandler: [authorize('analytics')]
    },
    getCallsHandler
  );

  // Inbound Webhook endpoint for call tracking with rate limiting
  server.post(
    '/webhook',
    {
      schema: {
        body: createCallLogSchema,
      },
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      }
    },
    createCallWebhookHandler
  );
}
