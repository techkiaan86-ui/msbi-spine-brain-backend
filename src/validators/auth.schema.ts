import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const revokeSessionParamsSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
});

export type RevokeSessionParams = z.infer<typeof revokeSessionParamsSchema>;

// MFA Validation Schemas
export const mfaVerifySchema = z.object({
  mfaChallenge: z.string().min(10, 'MFA challenge is required'),
  code: z.string().regex(/^\d{6}$/, 'MFA code must be exactly 6 digits'),
});

export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaVerifyRecoverySchema = z.object({
  mfaChallenge: z.string().min(10, 'MFA challenge is required'),
  recoveryCode: z.string().min(6, 'Recovery code is required'),
});

export type MfaVerifyRecoveryInput = z.infer<typeof mfaVerifyRecoverySchema>;

export const mfaVerifyEnrollmentSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits'),
});

export type MfaVerifyEnrollmentInput = z.infer<typeof mfaVerifyEnrollmentSchema>;

export const mfaRegenerateRecoverySchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  code: z.string().regex(/^\d{6}$/, 'MFA verification code must be exactly 6 digits'),
});

export type MfaRegenerateRecoveryInput = z.infer<typeof mfaRegenerateRecoverySchema>;

export const mfaDisableSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  code: z.string().regex(/^\d{6}$/, 'MFA code must be 6 digits').optional(),
  recoveryCode: z.string().min(6, 'Recovery code must be at least 6 characters').optional(),
});

export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

