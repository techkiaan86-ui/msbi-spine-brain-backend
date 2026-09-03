import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  role: z.string().optional().default('USER'),
  departmentId: z.string().uuid().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  createdAt: z.date(),
});
