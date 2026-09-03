import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { 
  getBudgetOverviewHandler, 
  createExpenseHandler,
  getPlannedVsActualHandler,
  getVendorSpendingHandler,
  adjustBudgetHandler
} from '../controllers/budget.controller';
import { createExpenseSchema, adjustBudgetSchema } from '../validators/budget.schema';
import { authorize } from '../middlewares/rbac.middleware';

export async function budgetRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('budget'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get('/overview', getBudgetOverviewHandler);
  server.get('/planned-vs-actual', getPlannedVsActualHandler);
  server.get('/vendor-spending', getVendorSpendingHandler);

  server.post(
    '/expenses',
    {
      schema: {
        body: createExpenseSchema,
      },
    },
    createExpenseHandler
  );

  server.put(
    '/adjust',
    {
      schema: {
        body: adjustBudgetSchema,
      },
    },
    adjustBudgetHandler
  );
}
