import { FastifyRequest, FastifyReply } from 'fastify';
import { settingsService } from '../services/settings.service';
import { UpdateOrganizationInput } from '../validators/settings.schema';

export const getOrganizationHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const org = await settingsService.getOrganization();
  return reply.send({ success: true, data: org });
};

export const updateOrganizationHandler = async (
  request: FastifyRequest<{ Body: UpdateOrganizationInput }>,
  reply: FastifyReply
) => {
  const org = await settingsService.updateOrganization(request.body);
  return reply.send({ success: true, data: org });
};

export const getClinicsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const clinics = await settingsService.getClinics();
  return reply.send({ success: true, data: clinics });
};

export const getProvidersHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const providers = await settingsService.getProviders();
  return reply.send({ success: true, data: providers });
};
