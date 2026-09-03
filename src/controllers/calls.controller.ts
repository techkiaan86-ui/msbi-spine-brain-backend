import { FastifyRequest, FastifyReply } from 'fastify';
import { callsService } from '../services/calls.service';
import { CreateCallLogInput } from '../validators/calls.schema';

export const createCallWebhookHandler = async (
  request: FastifyRequest<{ Body: CreateCallLogInput }>,
  reply: FastifyReply
) => {
  const callLog = await callsService.createCall(request.body);
  return reply.send({ success: true, data: callLog });
};

export const getCallsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const calls = await callsService.getCalls();
  return reply.send({ success: true, data: calls });
};
