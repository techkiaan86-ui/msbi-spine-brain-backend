import { FastifyRequest, FastifyReply } from 'fastify';
import { reportsService } from '../services/reports.service';
import { GenerateReportInput } from '../validators/reports.schema';
import { auditService, SecurityEvents } from '../services/audit.service';

export const generateReportHandler = async (
  request: FastifyRequest<{ Body: GenerateReportInput }>,
  reply: FastifyReply
) => {
  const result = await reportsService.triggerReportGeneration(request.body);

  await auditService.log({
    action: SecurityEvents.DATA_EXPORT,
    user: request.user,
    resourceType: 'Report',
    resourceId: result?.jobId || request.body.type,
    request,
    success: true
  });

  return reply.status(202).send({ success: true, data: result }); // 202 Accepted
};

export const getExportsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const exportsList = await reportsService.getExports();
  return reply.send({ success: true, data: exportsList });
};
