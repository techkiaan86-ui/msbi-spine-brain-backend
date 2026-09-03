import { z } from 'zod';

export const wordpressFormWebhookSchema = z.object({
  formId: z.string().optional(),
  formName: z.string().optional(),
  submissionId: z.string().optional(),
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  message: z.string().optional(),
  subject: z.string().optional(),
  location: z.string().optional(),
  service: z.string().optional(),
  sourceUrl: z.string().optional(),
  landingPage: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  gclid: z.string().optional(),
  fbclid: z.string().optional(),
  metadata: z.object({
    hadMRI: z.preprocess((val) => {
      if (val === '') return null;
      return val;
    }, z.enum(['Yes', 'No']).nullable().optional()),
    preferredContactMethod: z.preprocess((val) => {
      if (typeof val === 'string') {
        if (val === '' || val.startsWith('[')) return [];
        return val.split(',').map(s => s.trim()).filter(Boolean);
      }
      return val;
    }, z.array(z.enum(['Phone', 'Email']))).optional(),
    howDidYouHearAboutUs: z.string().max(1000).optional(),
  }).strict().optional(),
  submittedAt: z.string().optional()
}).catchall(z.any());

export type WordpressFormWebhookInput = z.infer<typeof wordpressFormWebhookSchema>;
