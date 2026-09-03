import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRolesHandler,
  createRoleHandler,
  updateRolePermissionsHandler,
  deleteRoleHandler
} from '../controllers/rbac.controller';
import { authorize } from '../middlewares/rbac.middleware';

export default async function (server: FastifyInstance) {
  server.addHook('preHandler', authorize('users-roles'));
  const typedServer = server.withTypeProvider<ZodTypeProvider>();

  typedServer.get('/', getRolesHandler);
  typedServer.post(
    '/',
    {
      schema: {
        body: z.object({
          name: z.string().min(2).max(50),
          permissions: z.record(z.string(), z.boolean()).optional()
        })
      }
    },
    createRoleHandler
  );
  typedServer.put(
    '/:name',
    {
      schema: {
        params: z.object({ name: z.string().min(1).max(50) }),
        body: z.object({ permissions: z.record(z.string(), z.boolean()) })
      }
    },
    updateRolePermissionsHandler
  );
  typedServer.delete(
    '/:name',
    {
      schema: {
        params: z.object({ name: z.string().min(1).max(50) })
      }
    },
    deleteRoleHandler
  );
}
