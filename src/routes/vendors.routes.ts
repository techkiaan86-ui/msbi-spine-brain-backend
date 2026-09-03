import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { 
  getVendorsHandler, 
  getVendorByIdHandler, 
  createVendorHandler,
  getRenewalsHandler,
  getContractsHandler,
  getInvoicesHandler,
  createContactHandler,
  createContractHandler,
  createInvoiceHandler,
  updateInvoiceStatusHandler
} from '../controllers/vendors.controller';
import { 
  createVendorSchema, 
  createContactSchema, 
  createContractSchema, 
  createInvoiceSchema, 
  updateInvoiceStatusSchema 
} from '../validators/vendors.schema';
import { z } from 'zod';
import { authorize } from '../middlewares/rbac.middleware';

export async function vendorRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authorize('vendors'));
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  server.get('/', getVendorsHandler);
  server.get('/renewals', getRenewalsHandler);
  
  server.get('/:id', { schema: { params: z.object({ id: z.string().uuid() }) } }, getVendorByIdHandler);
  
  server.post('/', { schema: { body: createVendorSchema } }, createVendorHandler);

  server.get('/:id/contracts', { schema: { params: z.object({ id: z.string().uuid() }) } }, getContractsHandler);
  server.get('/:id/invoices', { schema: { params: z.object({ id: z.string().uuid() }) } }, getInvoicesHandler);

  // Endpoints for dynamic workflows
  server.post('/:id/contacts', { schema: { params: z.object({ id: z.string().uuid() }), body: createContactSchema } }, createContactHandler);
  server.post('/:id/contracts', { schema: { params: z.object({ id: z.string().uuid() }), body: createContractSchema } }, createContractHandler);
  server.post('/:id/invoices', { schema: { params: z.object({ id: z.string().uuid() }), body: createInvoiceSchema } }, createInvoiceHandler);
  server.put('/invoices/:id/status', { schema: { params: z.object({ id: z.string().uuid() }), body: updateInvoiceStatusSchema } }, updateInvoiceStatusHandler);
}
