import { FastifyRequest, FastifyReply } from 'fastify';
import { leadsService } from '../services/leads.service';
import { CreateLeadInput } from '../validators/leads.schema';

export const createLeadWebhookHandler = async (
  request: FastifyRequest<{ Body: CreateLeadInput }>,
  reply: FastifyReply
) => {
  const lead = await leadsService.createLead(request.body);
  return reply.send({ success: true, data: lead });
};

export const getLeadsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const leads = await leadsService.getLeads();
  return reply.send({ success: true, data: leads });
};
