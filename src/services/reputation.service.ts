import prisma from '../plugins/db';
import { CreateReviewRequestInput, CreateReviewInput } from '../validators/reputation.schema';
import { notificationService } from './notification.service';

export class ReputationService {
  async getReviews() {
    return prisma.review.findMany({
      where: { platform: 'Google' },
      include: {
        clinic: true,
        provider: true,
      },
      orderBy: { date: 'desc' },
    });
  }

  async getClinicRatings() {
    return prisma.clinic.findMany({
      include: {
        reviews: {
          where: { platform: 'Google' },
          select: { rating: true }
        }
      }
    });
  }

  async getProviderRatings() {
    return prisma.provider.findMany({
      include: {
        reviews: {
          where: { platform: 'Google' },
          select: { rating: true }
        }
      }
    });
  }

  async sendReviewRequest(data: CreateReviewRequestInput) {
    let clinicName = 'Midwest Spine & Brain Institute';
    let reviewLink = data.googleReviewUrl || 'https://midwestspine.net/review';

    if (data.clinicId) {
      const clinic = await prisma.clinic.findUnique({
        where: { id: data.clinicId }
      });
      if (clinic) {
        clinicName = clinic.name;
        if (clinic.googleLocationId) {
          const locId = clinic.googleLocationId.replace('locations/', '');
          reviewLink = `https://search.google.com/local/writereview?placeid=${locId}`;
        }
      }
    }

    // Dispatch via Paubox Email / SMS
    let deliveryStatus = 'SENT';
    try {
      await notificationService.sendPatientReviewRequest({
        to: data.contactInfo,
        patientName: data.patientName,
        clinicName: clinicName,
        reviewLink: reviewLink,
        method: data.method || (data.contactInfo.includes('@') ? 'EMAIL' : 'SMS')
      });
    } catch (err: any) {
      console.error('[REVIEW REQUEST DELIVERY FAILED]:', err.message);
      deliveryStatus = 'FAILED';
    }

    return prisma.reviewRequest.create({
      data: {
        patientName: data.patientName,
        contactInfo: data.contactInfo,
        status: deliveryStatus,
      },
    });
  }

  async createReview(data: CreateReviewInput) {
    const email = data.email.trim().toLowerCase();
    const phone = data.phone.trim();
    const name = `${data.firstName.trim()} ${data.lastName.trim()}`;

    // 1. Calculate star rating from the 4 boolean questions (range: 1 to 5 stars)
    let rating = 1;
    if (data.providerAnsweredQuestions) rating++;
    if (data.providerExplainedClearly) rating++;
    if (data.staffHelpful) rating++;
    if (data.wouldRecommend) rating++;

    // 2. Find or create lead
    let lead = await prisma.lead.findFirst({
      where: {
        OR: [
          { email: email },
          { phone: phone }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    const externalReviewId = `wp_rev_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    if (!lead) {
      lead = await prisma.lead.create({
        data: {
          name,
          email,
          phone,
          source: 'Share Your Experience Form',
          status: 'New',
          leadPlatform: 'wordpress',
          externalLeadId: externalReviewId
        }
      });
    }

    // 3. Normalize providerId and clinicId (convert empty strings to null)
    const providerId = data.providerId && data.providerId.trim() !== '' ? data.providerId : null;
    const clinicId = data.clinicId && data.clinicId.trim() !== '' ? data.clinicId : null;

    // 4. Create FormSubmission instead of Review (CRM Lead / FormSubmission flow)
    return prisma.formSubmission.create({
      data: {
        externalSubmissionId: externalReviewId,
        leadId: lead.id,
        formId: 'share_your_experience',
        formName: 'Share Your Experience Form',
        name,
        email,
        phone,
        message: data.comment,
        metadata: {
          rating,
          providerAnsweredQuestions: data.providerAnsweredQuestions,
          providerExplainedClearly: data.providerExplainedClearly,
          staffHelpful: data.staffHelpful,
          wouldRecommend: data.wouldRecommend,
          clinicId,
          providerId
        },
        submittedAt: new Date()
      }
    });
  }

  async getMappings() {
    return prisma.clinic.findMany({
      select: {
        id: true,
        name: true,
        googleLocationId: true
      }
    });
  }

  async saveMappings(mappings: { clinicId: string; googleLocationId: string | null }[]) {
    for (const mapping of mappings) {
      await prisma.clinic.update({
        where: { id: mapping.clinicId },
        data: { googleLocationId: mapping.googleLocationId }
      });
    }
  }
}

export const reputationService = new ReputationService();
