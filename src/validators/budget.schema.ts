import { z } from 'zod';

export const createExpenseSchema = z.object({
  budgetId: z.string().uuid(),
  category: z.string(),
  amount: z.number().positive(),
  vendorId: z.string().uuid().optional(),
  date: z.string().datetime(),
  description: z.string().optional(),
});

export const adjustBudgetSchema = z.object({
  budgetId: z.string().uuid(),
  totalPlanned: z.number().nonnegative(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type AdjustBudgetInput = z.infer<typeof adjustBudgetSchema>;
