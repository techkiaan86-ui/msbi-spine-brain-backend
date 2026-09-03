import fastify, { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { errorHandler } from './middlewares/error.middleware';
import { securityHeadersHook } from './middlewares/security-headers.middleware';
import { authRoutes } from './routes/auth.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { userRoutes } from './routes/users.routes';
import { campaignRoutes } from './routes/campaigns.routes';
import { budgetRoutes } from './routes/budget.routes';
import { vendorRoutes } from './routes/vendors.routes';
import { analyticsRoutes } from './routes/analytics.routes';
import { reputationRoutes } from './routes/reputation.routes';
import { settingsRoutes } from './routes/settings.routes';
import { reportsRoutes } from './routes/reports.routes';
import { integrationsRoutes } from './routes/integrations.routes';
import { leadsRoutes } from './routes/leads.routes';
import { callsRoutes } from './routes/calls.routes';
import { formSubmissionsRoutes } from './routes/form-submissions.routes';
import rbacRoutes from './routes/rbac.routes';
import googleOAuthRoutes from './routes/google-oauth.routes';
import { webhooksRoutes } from './routes/webhooks.routes';
import { complianceRoutes } from './routes/compliance.routes';
import fastifyRateLimit from '@fastify/rate-limit';
import crypto from 'crypto';

export const buildApp = () => {
  const app = fastify({
    logger: false, // Custom Pino logger used in server.ts
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const incomingId = req.headers['x-request-id'];
      if (typeof incomingId === 'string' && incomingId.length > 0 && incomingId.length <= 128) {
        // Sanitize caller-supplied request ID
        return incomingId.replace(/[^a-zA-Z0-9-_]/g, '');
      }
      return crypto.randomUUID();
    },
    bodyLimit: 1048576, // 1MB standard request body limit
    routerOptions: {
      ignoreTrailingSlash: true
    }
  });

  // Setup Zod compiler for validation
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Handle empty JSON bodies gracefully instead of throwing FST_ERR_CTP_EMPTY_JSON_BODY
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req: FastifyRequest, body: string, done: (err: Error | null, body?: any) => void) => {
    try {
      // Remove unescaped control characters to prevent JSON.parse from failing on bad frontend input
      const sanitizedBody = body ? body.replace(/[\u0000-\u001F]+/g, "") : '{}';
      const json = JSON.parse(sanitizedBody);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err);
    }
  });

  // Global Error Handler
  app.setErrorHandler(errorHandler);

  // Attach Security Headers & Request Correlation ID to all responses
  app.addHook('onSend', securityHeadersHook);

  // Environment-based CORS Configuration
  const configuredOriginsEnv = process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL;
  const configuredOrigins = configuredOriginsEnv
    ? configuredOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001',
    'http://localhost:5174',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5174',
    'https://msbi-spine-brain.netlify.app',
    'https://msbi-spine-brain.netlify.app/'
  ];

  app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no Origin header (e.g. server-to-server, curl, mobile apps)
      if (!origin) {
        return cb(null, true);
      }

      // Check configured production allowed origins
      if (configuredOrigins.includes(origin)) {
        return cb(null, true);
      }

      // Allow local development origins (enables testing local frontend against live backend)
      if (defaultDevOrigins.includes(origin)) {
        return cb(null, true);
      }

      // Reject unauthorized origins
      return cb(new Error('CORS not allowed for this origin'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-webhook-secret', 'x-request-id'],
    exposedHeaders: ['x-request-id']
  });

  // Global Rate Limiting with route-specific overrides
  app.register(fastifyRateLimit, {
    global: false, // Applied per route-level config or selectively
    errorResponseBuilder: (_req, context) => ({
      success: false,
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded, retry in ${context.after}`
    })
  });

  // API Status & Health Routes
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });


  // Register Domain Modules
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
  app.register(userRoutes, { prefix: '/api/v1/users' });
  app.register(campaignRoutes, { prefix: '/api/v1/campaigns' });
  app.register(budgetRoutes, { prefix: '/api/v1/budget' });
  app.register(vendorRoutes, { prefix: '/api/v1/vendors' });
  app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  app.register(reputationRoutes, { prefix: '/api/v1/reputation' });
  app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  app.register(reportsRoutes, { prefix: '/api/v1/reports' });
  app.register(integrationsRoutes, { prefix: '/api/v1/integrations' });
  app.register(leadsRoutes, { prefix: '/api/v1/leads' });
  app.register(callsRoutes, { prefix: '/api/v1/calls' });
  app.register(formSubmissionsRoutes, { prefix: '/api/v1/form-submissions' });
  app.register(rbacRoutes, { prefix: '/api/v1/roles' });
  app.register(googleOAuthRoutes, { prefix: '/api/v1/integrations' });
  app.register(webhooksRoutes, { prefix: '/api/v1/webhooks' });
  app.register(complianceRoutes, { prefix: '/api/v1/compliance' });

  return app;
};




