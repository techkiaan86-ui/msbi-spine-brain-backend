import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  timeframe: z.enum(['today', 'week', 'month', 'year']).optional().default('month'),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
