import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { 
  getOrganizationHandler, 
  updateOrganizationHandler, 
  getClinicsHandler,
  getProvidersHandler 
} from '../controllers/settings.controller';
import { updateOrganizationSchema } from '../validators/settings.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function settingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('settings'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get('/organization', getOrganizationHandler);
  server.put('/organization', { schema: { body: updateOrganizationSchema } }, updateOrganizationHandler);
  
  server.get('/clinics', getClinicsHandler);
  server.get('/providers', getProvidersHandler);
}
