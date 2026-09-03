import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { 
  getUsersHandler, 
  createUserHandler,
  getRolesHandler,
  getActivityLogsHandler,
  updateNotificationPreferencesHandler
} from '../controllers/users.controller';
import { createUserSchema } from '../validators/users.schema';
import { z } from 'zod';
import { authenticate } from '../middlewares/auth.middleware';
import { authorize } from '../middlewares/rbac.middleware';

export async function userRoutes(fastify: FastifyInstance) {
  // All user routes require authentication
  fastify.addHook('preHandler', authenticate);
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  // Administrative user management endpoints require 'users-roles' permission
  server.get('/', { preHandler: [authorize('users-roles')] }, getUsersHandler);
  
  server.post(
    '/',
    {
      preHandler: [authorize('users-roles')],
      schema: { body: createUserSchema },
    },
    createUserHandler
  );

  server.get('/roles', { preHandler: [authorize('users-roles')] }, getRolesHandler);
  
  // Security audit trail API (restricted to authorized administrators with 'users-roles' permission)
  server.get('/activity-logs', {
    preHandler: [authorize('users-roles')],
    schema: {
      querystring: z.object({
        startDate: z.string().max(50).optional(),
        endDate: z.string().max(50).optional(),
        userId: z.string().max(100).optional(),
        userRole: z.string().max(50).optional(),
        action: z.string().max(50).optional(),
        resourceType: z.string().max(50).optional(),
        success: z.union([z.boolean(), z.string().transform(v => v === 'true')]).optional(),
        search: z.string().max(100, 'Search query cannot exceed 100 characters').optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(50)
      })
    }
  }, getActivityLogsHandler);

  // Notification preferences endpoint: any authenticated user can update their OWN preferences;
  // Admin can update any user's preferences (enforced via ResourceAuth in handler)
  server.put('/:id/notifications', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        phoneNumber: z.string().max(30).optional().nullable(),
        emailAlerts: z.boolean(),
        smsAlerts: z.boolean(),
        alertLocations: z.array(z.string().max(100)).optional().nullable()
      })
    }
  }, updateNotificationPreferencesHandler);
}
