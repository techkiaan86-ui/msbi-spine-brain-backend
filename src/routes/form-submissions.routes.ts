import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getFormSubmissionsHandler, getFormSubmissionByIdHandler } from '../controllers/form-submissions.controller';
import { authorize } from '../middlewares/rbac.middleware';

export async function formSubmissionsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('analytics'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get('', getFormSubmissionsHandler);
  server.get('/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, getFormSubmissionByIdHandler);
}
