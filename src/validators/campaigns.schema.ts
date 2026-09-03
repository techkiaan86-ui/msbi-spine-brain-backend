import { z } from 'zod';

export const createCampaignSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['Active', 'Completed', 'Draft']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  budget: z.number().positive(),
  goal: z.string().optional(),
  ownerId: z.string().uuid(),
});

export const updateCampaignSchema = z.object({
  status: z.enum(['Active', 'Completed', 'Draft']).optional(),
  budget: z.number().positive().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().min(2),
  status: z.enum(['Pending', 'In Progress', 'Completed']),
  dueDate: z.string().datetime().optional(),
  assignedTo: z.string().uuid().optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
