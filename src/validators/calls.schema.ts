import { z } from 'zod';

export const createCallLogSchema = z.object({
  caller: z.string().optional(),
  phone: z.string().min(1, 'Phone is required'),
  duration: z.string().min(1, 'Duration is required'),
  campaign: z.string().optional(),
  status: z.string().optional(),
  location: z.string().optional(),
  audioUrl: z.string().optional(),
});

export type CreateCallLogInput = z.infer<typeof createCallLogSchema>;
