import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import prisma from '../plugins/db';
import { WordpressFormWebhookInput, wordpressFormWebhookSchema } from '../validators/webhooks.schema';
import { googleBusinessService } from '../services/google-business.service';

export const wordpressFormHandler = async (
  request: FastifyRequest<{ Body: WordpressFormWebhookInput }>,
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

  // Timing safe equal requires same length
  if (secretBuffer.length !== incomingBuffer.length || !crypto.timingSafeEqual(secretBuffer, incomingBuffer)) {
    return reply.status(403).send({ success: false, error: 'Forbidden: Invalid webhook secret' });
  }

  const data = request.body;

  // 2. Validate essential fields (Need email or phone)
  const normalizedEmail = (data.email || '').trim().toLowerCase();
  const normalizedPhone = (data.phone || '').trim();
  const name = (data.name || [data.firstName, data.lastName].filter(Boolean).join(' ') || '').trim();

  if (!normalizedEmail && !normalizedPhone) {
    return reply.status(400).send({ success: false, error: 'Bad Request: Must provide email or phone' });
  }

  // 3. Normalized Payload
  const formId = data.formId ? String(data.formId).trim() : null;
  const formName = data.formName ? String(data.formName).trim() : null;
  const message = data.message ? String(data.message).trim() : null;
  const submittedAtRaw = data.submittedAt ? String(data.submittedAt).trim() : null;
  const submittedAt = submittedAtRaw ? new Date(submittedAtRaw) : null;
  
  // 4. Idempotency logic
  let externalSubmissionId = data.submissionId ? String(data.submissionId).trim() : null;

  if (!externalSubmissionId) {
    // Generate deterministic hash without receivedAt or Date.now()
    const hashPayload = [
      formId || '',
      formName || '',
      normalizedEmail,
      normalizedPhone,
      data.sourceUrl || '',
      message || ''
    ].join('|');
    
    externalSubmissionId = crypto.createHash('sha256').update(hashPayload).digest('hex');
  }

  // 5. Check if FormSubmission already exists (duplicate replay)
  const existingSubmission = await prisma.formSubmission.findUnique({
    where: { externalSubmissionId }
  });

  if (existingSubmission) {
    return reply.send({ success: true, message: 'Duplicate submission ignored', data: existingSubmission });
  }

  // 6. Lead linking / creation
  let lead = null;
  
  // Find lead by email (or phone in future)
  if (normalizedEmail) {
    // Check if there is an existing lead with this email to group under
    lead = await prisma.lead.findFirst({
      where: { email: normalizedEmail },
      orderBy: { createdAt: 'desc' }
    });
  } else if (normalizedPhone) {
    lead = await prisma.lead.findFirst({
      where: { phone: normalizedPhone },
      orderBy: { createdAt: 'desc' }
    });
  }

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        name: name || 'Unknown Patient',
        email: normalizedEmail || null,
        phone: normalizedPhone || null,
        source: formName || 'Website Contact Form',
        status: 'New',
        leadPlatform: 'wordpress',
        externalLeadId: externalSubmissionId
      }
    });
  }

  // 7. Create FormSubmission
  const submission = await prisma.formSubmission.create({
    data: {
      externalSubmissionId,
      leadId: lead.id,
      formId,
      formName,
      name,
      email: normalizedEmail || null,
      phone: normalizedPhone || null,
      message,
      landingPage: data.landingPage || null,
      sourceUrl: data.sourceUrl || null,
      utmSource: data.utm_source || null,
      utmMedium: data.utm_medium || null,
      utmCampaign: data.utm_campaign || null,
      utmTerm: data.utm_term || null,
      utmContent: data.utm_content || null,
      gclid: data.gclid || null,
      fbclid: data.fbclid || null,
      metadata: data.metadata ? (data.metadata as any) : undefined,
      submittedAt
    }
  });

  return reply.send({ success: true, data: submission });
};

export const googleReviewsWebhookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const secret = process.env.GOOGLE_REVIEWS_WEBHOOK_SECRET;
  if (!secret) {
    return reply.status(500).send({ success: false, error: 'Server misconfiguration: Webhook secret not set' });
  }

  const incomingSecret = request.headers['x-webhook-secret'] || (request.query as any)?.secret;

  if (!incomingSecret || typeof incomingSecret !== 'string') {
    return reply.status(401).send({ success: false, error: 'Unauthorized: Missing webhook secret' });
  }

  const secretBuffer = Buffer.from(secret);
  const incomingBuffer = Buffer.from(incomingSecret);

  if (secretBuffer.length !== incomingBuffer.length || !crypto.timingSafeEqual(secretBuffer, incomingBuffer)) {
    return reply.status(403).send({ success: false, error: 'Forbidden: Invalid webhook secret' });
  }

  const body = request.body as any;
  if (!body || !body.message || !body.message.data) {
    return reply.status(400).send({ success: false, error: 'Bad Request: Invalid Pub/Sub message structure' });
  }

  try {
    const decodedDataString = Buffer.from(body.message.data, 'base64').toString('utf-8');
    const parsedData = JSON.parse(decodedDataString);

    if (parsedData.alertType === 'NEW_REVIEW' && parsedData.userReview?.reviewName) {
      const reviewName = parsedData.userReview.reviewName;
      console.log(`[GOOGLE REVIEWS WEBHOOK] Fetching details for review: ${reviewName}`);
      
      const newReview = await googleBusinessService.fetchAndSaveSingleReview(reviewName);
      return reply.send({ success: true, message: 'Review synced and processed successfully', data: newReview });
    }

    return reply.send({ success: true, message: 'Non-review alert type or missing review name ignored.' });
  } catch (err: any) {
    console.error('[GOOGLE REVIEWS WEBHOOK] Failed to process webhook message:', err.message || err);
    return reply.status(500).send({ success: false, error: err.message || 'Internal server error' });
  }
};
