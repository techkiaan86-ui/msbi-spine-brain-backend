import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { generateReportHandler, getExportsHandler } from '../controllers/reports.controller';
import { generateReportSchema } from '../validators/reports.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function reportsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('reports'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/generate',
    {
      schema: {
        body: generateReportSchema,
      },
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute'
        }
      }
    },
    generateReportHandler
  );

  server.get(
    '/exports',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      }
    },
    getExportsHandler
  );
}
