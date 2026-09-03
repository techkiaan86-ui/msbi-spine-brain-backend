import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../plugins/db';
import { z } from 'zod';
import { auditService, SecurityEvents } from '../services/audit.service';

const querySchema = z.object({
  formName: z.string().optional(),
  campaign: z.string().optional(),
  source: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

export const getFormSubmissionsHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const query = querySchema.parse(request.query);
  
  const where: any = {};
  
  if (query.formName) where.formName = query.formName;
  if (query.campaign) where.utmCampaign = query.campaign;
  if (query.source) where.utmSource = query.source;
  
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate);
    if (query.endDate) where.createdAt.lte = new Date(query.endDate);
  }

  const submissions = await prisma.formSubmission.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      lead: {
        select: { id: true, status: true }
      }
    }
  });

  // Ensure we don't return raw sensitive bodies to generic analytics API consumers
  // The frontend requested "safe summary fields" for MarketingAnalytics
  const safeData = submissions.map(sub => ({
    id: sub.id,
    externalSubmissionId: sub.externalSubmissionId,
    leadId: sub.leadId,
    formName: sub.formName,
    name: sub.name,
    email: sub.email,
    phone: sub.phone,
    landingPage: sub.landingPage,
    sourceUrl: sub.sourceUrl,
    utmSource: sub.utmSource,
    utmMedium: sub.utmMedium,
    submittedAt: sub.submittedAt,
    createdAt: sub.createdAt,
    status: sub.lead?.status || 'Unknown'
  }));

  return reply.send({ success: true, data: safeData });
};

export const getFormSubmissionByIdHandler = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const { id } = request.params;
  
  const submission = await prisma.formSubmission.findUnique({
    where: { id },
    include: {
      lead: true
    }
  });

  if (!submission) {
    return reply.status(404).send({ success: false, error: 'Not found' });
  }

  // Audit logging for sensitive patient inquiry record access
  await auditService.log({
    action: SecurityEvents.PATIENT_VIEW,
    user: request.user,
    resourceType: 'FormSubmission',
    resourceId: id,
    request,
    success: true
  });

  return reply.send({ success: true, data: submission });
};
