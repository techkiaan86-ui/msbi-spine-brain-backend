import { z } from 'zod';

/**
 * Validates that a URL string uses only http or https schemes.
 * Blocks javascript:, data:, file:, vbscript: and other dangerous schemes.
 */
const safeDocumentUrl = z.string().url().refine(
  (val) => {
    try {
      const parsed = new URL(val);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'documentUrl must use http or https protocol' }
).nullable().optional();

export const createVendorSchema = z.object({
  name: z.string().min(2),
  category: z.string(),
  performanceScore: z.number().min(0).max(10).optional(),
});

export const createContactSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
});

export const createContractSchema = z.object({
  value: z.number().positive(),
  startDate: z.string(), // ISO String
  renewalDate: z.string(), // ISO String
  documentUrl: safeDocumentUrl,
});

export const createInvoiceSchema = z.object({
  amount: z.number().positive(),
  status: z.enum(['Paid', 'Pending', 'Overdue']),
  dueDate: z.string(), // ISO String
  documentUrl: safeDocumentUrl,
});

export const updateInvoiceStatusSchema = z.object({
  status: z.enum(['Paid', 'Pending', 'Overdue']),
});

export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>;
