import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { wordpressFormHandler, googleReviewsWebhookHandler } from '../controllers/webhooks.controller';
import { wordpressFormWebhookSchema } from '../validators/webhooks.schema';

export async function webhooksRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/wordpress/forms',
    {
      schema: {
        body: wordpressFormWebhookSchema,
      },
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute'
        }
      }
    },
    wordpressFormHandler
  );

  server.post(
    '/google-reviews',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      }
    },
    googleReviewsWebhookHandler
  );
}
