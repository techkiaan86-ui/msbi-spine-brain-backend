import { FastifyRequest, FastifyReply } from 'fastify';
import { dashboardService } from '../services/dashboard.service';
import { DashboardQuery } from '../validators/dashboard.schema';

export const getDashboardSummaryHandler = async (
  request: FastifyRequest<{ Querystring: DashboardQuery }>,
  reply: FastifyReply
) => {
  try {
    const data = await dashboardService.getSummary(request.query);
    return reply.send({ success: true, data });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};
