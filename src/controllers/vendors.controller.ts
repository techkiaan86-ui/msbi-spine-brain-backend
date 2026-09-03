import { FastifyRequest, FastifyReply } from 'fastify';
import { vendorsService } from '../services/vendors.service';
import prisma from '../plugins/db';
import { 
  CreateVendorInput, 
  CreateContactInput, 
  CreateContractInput, 
  CreateInvoiceInput, 
  UpdateInvoiceStatusInput 
} from '../validators/vendors.schema';

export const getVendorsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const vendors = await vendorsService.getAllVendors();
  return reply.send({ success: true, data: vendors });
};

export const getVendorByIdHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const vendor = await vendorsService.getVendorById(request.params.id);
  if (!vendor) {
    return reply.status(404).send({ success: false, message: 'Vendor not found' });
  }
  return reply.send({ success: true, data: vendor });
};

export const createVendorHandler = async (
  request: FastifyRequest<{ Body: CreateVendorInput }>,
  reply: FastifyReply
) => {
  const vendor = await vendorsService.createVendor(request.body);
  return reply.status(201).send({ success: true, data: vendor });
};

export const getRenewalsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const renewals = await vendorsService.getUpcomingRenewals();
  return reply.send({ success: true, data: renewals });
};

export const getContractsHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const vendor = await vendorsService.getVendorById(request.params.id);
  if (!vendor) {
    return reply.status(404).send({ success: false, message: 'Vendor not found' });
  }
  const contracts = await vendorsService.getVendorContracts(request.params.id);
  return reply.send({ success: true, data: contracts });
};

export const getInvoicesHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const vendor = await vendorsService.getVendorById(request.params.id);
  if (!vendor) {
    return reply.status(404).send({ success: false, message: 'Vendor not found' });
  }
  const invoices = await vendorsService.getVendorInvoices(request.params.id);
  return reply.send({ success: true, data: invoices });
};

export const createContactHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: CreateContactInput }>,
  reply: FastifyReply
) => {
  const vendor = await vendorsService.getVendorById(request.params.id);
  if (!vendor) {
    return reply.status(404).send({ success: false, message: 'Vendor not found' });
  }
  const contact = await vendorsService.createContact(request.params.id, request.body);
  return reply.status(201).send({ success: true, data: contact });
};

export const createContractHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: CreateContractInput }>,
  reply: FastifyReply
) => {
  const vendor = await vendorsService.getVendorById(request.params.id);
  if (!vendor) {
    return reply.status(404).send({ success: false, message: 'Vendor not found' });
  }
  const contract = await vendorsService.createContract(request.params.id, request.body);
  return reply.status(201).send({ success: true, data: contract });
};

export const createInvoiceHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: CreateInvoiceInput }>,
  reply: FastifyReply
) => {
  const vendor = await vendorsService.getVendorById(request.params.id);
  if (!vendor) {
    return reply.status(404).send({ success: false, message: 'Vendor not found' });
  }
  const invoice = await vendorsService.createInvoice(request.params.id, request.body);
  return reply.status(201).send({ success: true, data: invoice });
};

export const updateInvoiceStatusHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateInvoiceStatusInput }>,
  reply: FastifyReply
) => {
  const existing = await prisma.invoice.findUnique({ where: { id: request.params.id } });
  if (!existing) {
    return reply.status(404).send({ success: false, message: 'Invoice not found' });
  }
  const updated = await vendorsService.updateInvoiceStatus(request.params.id, request.body.status);
  return reply.send({ success: true, data: updated });
};
