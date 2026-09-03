import { z } from 'zod';

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  timezone: z.string().optional(),
  currency: z.string().optional(),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
