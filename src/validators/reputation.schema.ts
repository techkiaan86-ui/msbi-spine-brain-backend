import { z } from 'zod';

const booleanCoercible = z.preprocess((val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (normalized === 'yes' || normalized === 'true') return true;
    if (normalized === 'no' || normalized === 'false') return false;
  }
  return val;
}, z.boolean());

export const createReviewRequestSchema = z.object({
  patientName: z.string().min(2),
  contactInfo: z.string().min(3),
  method: z.enum(['SMS', 'EMAIL']).optional().default('EMAIL'),
  clinicId: z.string().optional().nullable(),
  googleReviewUrl: z.string().optional().nullable(),
});

export const createReviewSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(5),
  comment: z.string().min(1),
  providerAnsweredQuestions: booleanCoercible,
  providerExplainedClearly: booleanCoercible,
  staffHelpful: booleanCoercible,
  wouldRecommend: booleanCoercible,
  providerId: z.string().uuid().nullable().optional().or(z.literal('')),
  clinicId: z.string().uuid().nullable().optional().or(z.literal('')),
});

export type CreateReviewRequestInput = z.infer<typeof createReviewRequestSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
