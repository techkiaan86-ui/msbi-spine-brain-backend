import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { 
  getComplianceStatusHandler, 
  getAccessReviewHandler,
  getRecoveryStatusHandler
} from '../controllers/compliance.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { authorize } from '../middlewares/rbac.middleware';

export async function complianceRoutes(fastify: FastifyInstance) {
  // All compliance endpoints require authenticated session
  fastify.addHook('preHandler', authenticate);
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  // High-level compliance governance overview (requires settings or users-roles permission)
  server.get(
    '/status',
    { preHandler: [authorize(['settings', 'users-roles'])] },
    getComplianceStatusHandler
  );

  // Periodic workforce access review snapshot (requires users-roles permission)
  server.get(
    '/access-review',
    { preHandler: [authorize('users-roles')] },
    getAccessReviewHandler
  );

  // Disaster recovery and system readiness diagnostics (requires settings permission)
  server.get(
    '/recovery-status',
    {
      preHandler: [authorize('settings')],
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute'
        }
      }
    },
    getRecoveryStatusHandler
  );
}
