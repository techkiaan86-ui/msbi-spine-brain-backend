import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { 
  getCampaignsHandler, 
  getCampaignByIdHandler, 
  createCampaignHandler,
  updateCampaignHandler,
  getTasksHandler,
  addTaskHandler,
  getAllTasksHandler,
  updateTaskStatusHandler,
  getAllAssetsHandler,
  downloadAssetHandler
} from '../controllers/campaigns.controller';
import { createCampaignSchema, updateCampaignSchema, createTaskSchema } from '../validators/campaigns.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function campaignRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('campaigns'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get('/', {
    schema: { querystring: z.object({ status: z.string().optional() }) }
  }, getCampaignsHandler);

  server.get('/tasks/all', getAllTasksHandler);
  server.put('/tasks/:id', {
    schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.string() }) }
  }, updateTaskStatusHandler);

  server.get('/assets/all', getAllAssetsHandler);
  server.get('/assets/:id/download', {
    schema: { params: z.object({ id: z.string().uuid() }) }
  }, downloadAssetHandler);
  
  server.get('/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, getCampaignByIdHandler);

  server.post('/', { schema: { body: createCampaignSchema } }, createCampaignHandler);

  server.put('/:id', { 
    schema: { params: z.object({ id: z.string().uuid() }), body: updateCampaignSchema } 
  }, updateCampaignHandler);

  server.get('/:id/tasks', { schema: { params: z.object({ id: z.string().uuid() }) } }, getTasksHandler);
  
  server.post('/:id/tasks', { 
    schema: { params: z.object({ id: z.string().uuid() }), body: createTaskSchema } 
  }, addTaskHandler);
}
