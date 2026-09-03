import { z } from 'zod';

export const generateReportSchema = z.object({
  type: z.enum(['EXECUTIVE', 'MARKETING', 'BUDGET']),
  format: z.enum(['PDF', 'EXCEL']),
  dateRange: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),
}).refine(
  (data) => new Date(data.dateRange.start) <= new Date(data.dateRange.end),
  {
    message: 'dateRange.start must be before or equal to dateRange.end',
    path: ['dateRange', 'start'],
  }
);

export type GenerateReportInput = z.infer<typeof generateReportSchema>;
