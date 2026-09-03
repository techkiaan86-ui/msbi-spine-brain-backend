import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { reputationService } from '../services/reputation.service';
import { CreateReviewRequestInput, CreateReviewInput } from '../validators/reputation.schema';
import { googleBusinessService } from '../services/google-business.service';

export const getReviewsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const reviews = await reputationService.getReviews();
  const mapped = reviews.map(r => ({
    ...r,
    patientName: r.authorName || [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Anonymous',
    isVerified: true,
    reply: r.reply || null
  }));
  return reply.send({ success: true, data: mapped });
};

export const getClinicRatingsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const clinics = await reputationService.getClinicRatings();
  // Map to calculate average
  const mapped = clinics.map(c => {
    const total = c.reviews.reduce((acc, r) => acc + r.rating, 0);
    const avg = c.reviews.length ? (total / c.reviews.length).toFixed(1) : 0;
    return { id: c.id, name: c.name, averageRating: parseFloat(String(avg)), reviewCount: c.reviews.length };
  });
  return reply.send({ success: true, data: mapped });
};

export const getProviderRatingsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const providers = await reputationService.getProviderRatings();
  // Map to calculate average
  const mapped = providers.map(p => {
    const total = p.reviews.reduce((acc, r) => acc + r.rating, 0);
    const avg = p.reviews.length ? (total / p.reviews.length).toFixed(1) : 0;
    return { id: p.id, name: p.name, averageRating: parseFloat(String(avg)), reviewCount: p.reviews.length };
  });
  return reply.send({ success: true, data: mapped });
};

export const sendReviewRequestHandler = async (
  request: FastifyRequest<{ Body: CreateReviewRequestInput }>,
  reply: FastifyReply
) => {
  const reviewRequest = await reputationService.sendReviewRequest(request.body);
  return reply.status(201).send({ success: true, data: reviewRequest });
};

export const createReviewHandler = async (
  request: FastifyRequest<{ Body: CreateReviewInput }>,
  reply: FastifyReply
) => {
  // 1. Webhook Security: timing-safe comparison
  const secret = process.env.WORDPRESS_FORM_WEBHOOK_SECRET;
  if (!secret) {
    return reply.status(500).send({ success: false, error: 'Server misconfiguration: Webhook secret not set' });
  }

  const incomingSecret = request.headers['x-webhook-secret'];
  if (!incomingSecret || typeof incomingSecret !== 'string') {
    return reply.status(401).send({ success: false, error: 'Unauthorized: Missing webhook secret' });
  }

  const secretBuffer = Buffer.from(secret);
  const incomingBuffer = Buffer.from(incomingSecret);

  if (secretBuffer.length !== incomingBuffer.length || !crypto.timingSafeEqual(secretBuffer, incomingBuffer)) {
    return reply.status(403).send({ success: false, error: 'Forbidden: Invalid webhook secret' });
  }

  // 2. Call service to create review and match lead
  const review = await reputationService.createReview(request.body);
  return reply.status(201).send({ success: true, data: review });
};

export const getGbpAccountsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const accounts = await googleBusinessService.getAccessibleAccounts();
    return reply.send({ success: true, data: accounts });
  } catch (err: any) {
    const statusCode = err.statusCode || (err.message && err.message.includes('429') ? 429 : 500);
    return reply.status(statusCode).send({ success: false, error: err.message });
  }
};

export const getGbpLocationsHandler = async (
  request: FastifyRequest<{ Querystring: { accountId: string } }>,
  reply: FastifyReply
) => {
  try {
    const { accountId } = request.query;
    if (!accountId) {
      return reply.status(400).send({ success: false, error: 'Missing accountId query parameter' });
    }
    const locations = await googleBusinessService.getAccessibleLocations(accountId);
    return reply.send({ success: true, data: locations });
  } catch (err: any) {
    const statusCode = err.statusCode || (err.message && err.message.includes('429') ? 429 : 500);
    return reply.status(statusCode).send({ success: false, error: err.message });
  }
};

export const getMappingsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const mappings = await reputationService.getMappings();
    return reply.send({ success: true, data: mappings });
  } catch (err: any) {
    return reply.status(500).send({ success: false, error: err.message });
  }
};

export const saveMappingsHandler = async (
  request: FastifyRequest<{ Body: { mappings: { clinicId: string; googleLocationId: string | null }[] } }>,
  reply: FastifyReply
) => {
  try {
    const { mappings } = request.body;
    await reputationService.saveMappings(mappings);
    return reply.send({ success: true, message: 'Mappings saved successfully' });
  } catch (err: any) {
    return reply.status(500).send({ success: false, error: err.message });
  }
};

export const replyToReviewHandler = async (
  request: FastifyRequest<{ Params: { id: string }; Body: { reply: string } }>,
  reply: FastifyReply
) => {
  try {
    const { id } = request.params;
    const { reply: replyText } = request.body;
    if (!replyText) {
      return reply.status(400).send({ success: false, error: 'Missing reply message text body parameter' });
    }
    const result = await googleBusinessService.replyToReview(id, replyText);
    return reply.send({ success: true, data: result });
  } catch (err: any) {
    return reply.status(500).send({ success: false, error: err.message });
  }
};

export const syncGbpReviewsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const result = await googleBusinessService.syncReviews();
    return reply.send({ success: true, data: result });
  } catch (err: any) {
    return reply.status(500).send({ success: false, error: err.message });
  }
};
