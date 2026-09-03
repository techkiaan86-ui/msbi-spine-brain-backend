import { z } from 'zod';

export const createLeadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  condition: z.string().optional().or(z.literal('')),
  source: z.string().optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
