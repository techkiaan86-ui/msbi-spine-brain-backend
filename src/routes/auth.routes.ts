import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  getCurrentUserHandler,
  changePasswordHandler,
  getSessionsHandler,
  revokeSessionHandler,
  revokeAllSessionsHandler,
  mfaStatusHandler,
  mfaEnrollHandler,
  mfaVerifyEnrollmentHandler,
  mfaVerifyLoginHandler,
  mfaVerifyRecoveryLoginHandler,
  mfaRegenerateRecoveryHandler,
  mfaDisableHandler
} from '../controllers/auth.controller';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  revokeSessionParamsSchema,
  mfaVerifySchema,
  mfaVerifyRecoverySchema,
  mfaVerifyEnrollmentSchema,
  mfaRegenerateRecoverySchema,
  mfaDisableSchema
} from '../validators/auth.schema';
import { authenticate } from '../middlewares/auth.middleware';

export async function authRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<ZodTypeProvider>();

  // Public login endpoint with strict rate limiting
  server.post(
    '/login',
    {
      schema: {
        body: loginSchema,
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute'
        }
      }
    },
    loginHandler
  );

  // Refresh token rotation endpoint with rate limiting
  server.post(
    '/refresh',
    {
      schema: {
        body: refreshSchema,
      },
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute'
        }
      }
    },
    refreshHandler
  );

  // Authenticated logout endpoint
  server.post(
    '/logout',
    {
      preHandler: [authenticate]
    },
    logoutHandler
  );

  // Authenticated user profile endpoint
  server.get(
    '/me',
    {
      preHandler: [authenticate]
    },
    getCurrentUserHandler
  );

  // Authenticated password change endpoint with rate limiting
  server.post(
    '/change-password',
    {
      preHandler: [authenticate],
      schema: {
        body: changePasswordSchema
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute'
        }
      }
    },
    changePasswordHandler
  );

  // Authenticated session listing endpoint
  server.get(
    '/sessions',
    {
      preHandler: [authenticate]
    },
    getSessionsHandler
  );

  // Authenticated revoke single session endpoint
  server.post(
    '/sessions/:sessionId/revoke',
    {
      preHandler: [authenticate],
      schema: {
        params: revokeSessionParamsSchema
      }
    },
    revokeSessionHandler
  );

  // Authenticated revoke all sessions endpoint
  server.post(
    '/sessions/revoke-all',
    {
      preHandler: [authenticate]
    },
    revokeAllSessionsHandler
  );

  // ---------------------------------------------------------------------------
  // Multi-Factor Authentication (MFA) Routes
  // ---------------------------------------------------------------------------

  // Authenticated MFA status lookup
  server.get(
    '/mfa/status',
    {
      preHandler: [authenticate]
    },
    mfaStatusHandler
  );

  // Authenticated start MFA enrollment
  server.post(
    '/mfa/enroll',
    {
      preHandler: [authenticate],
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute'
        }
      }
    },
    mfaEnrollHandler
  );

  // Authenticated verify MFA enrollment & enable
  server.post(
    '/mfa/verify-enrollment',
    {
      preHandler: [authenticate],
      schema: {
        body: mfaVerifyEnrollmentSchema
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute'
        }
      }
    },
    mfaVerifyEnrollmentHandler
  );

  // Public verify login challenge with TOTP
  server.post(
    '/mfa/verify',
    {
      schema: {
        body: mfaVerifySchema
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute'
        }
      }
    },
    mfaVerifyLoginHandler
  );

  // Public verify login challenge with one-time recovery code
  server.post(
    '/mfa/verify-recovery',
    {
      schema: {
        body: mfaVerifyRecoverySchema
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute'
        }
      }
    },
    mfaVerifyRecoveryLoginHandler
  );

  // Authenticated regenerate recovery codes (requires current password + TOTP)
  server.post(
    '/mfa/recovery-codes/regenerate',
    {
      preHandler: [authenticate],
      schema: {
        body: mfaRegenerateRecoverySchema
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute'
        }
      }
    },
    mfaRegenerateRecoveryHandler
  );

  // Authenticated disable MFA (requires current password + TOTP or recovery code)
  server.post(
    '/mfa/disable',
    {
      preHandler: [authenticate],
      schema: {
        body: mfaDisableSchema
      },
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute'
        }
      }
    },
    mfaDisableHandler
  );
}

