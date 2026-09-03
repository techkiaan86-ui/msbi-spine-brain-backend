import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getDashboardSummaryHandler } from '../controllers/dashboard.controller';
import { dashboardQuerySchema } from '../validators/dashboard.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('dashboard'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/summary',
    {
      schema: {
        querystring: dashboardQuerySchema,
      },
    },
    getDashboardSummaryHandler
  );
}
