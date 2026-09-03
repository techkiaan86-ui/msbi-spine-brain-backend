import { z } from 'zod';

export const syncIntegrationSchema = z.object({
  platformName: z.enum(['GA4', 'GOOGLE_ADS', 'META_ADS', 'HUBSPOT']),
});

export type SyncIntegrationInput = z.infer<typeof syncIntegrationSchema>;
