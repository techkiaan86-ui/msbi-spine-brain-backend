import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { googleOAuthService } from '../services/google.service';
import { integrationsService } from '../services/integrations.service';
import { ga4Service } from '../services/ga4.service';
import { authorize } from '../middlewares/rbac.middleware';

// Store state tokens in memory (in production, use Redis or DB with expiration)
// Maps state -> { userId, timestamp, subview, redirectOrigin }
const stateStore = new Map<string, { userId: string; timestamp: number; subview?: string; redirectOrigin?: string }>();

export default async function googleOAuthRoutes(fastify: FastifyInstance) {
  // Protected: Start OAuth flow for authenticated user with integrations permission
  fastify.get(
    '/google/oauth/start',
    { preHandler: [authorize('integrations')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id || 'admin';
      const query = request.query as { subview?: string; redirect_origin?: string };
      const subview = query.subview || 'ga4';
      const redirectOrigin = query.redirect_origin || process.env.FRONTEND_URL || 'http://localhost:3000';
      
      const state = googleOAuthService.generateStateToken();
      stateStore.set(state, { userId, timestamp: Date.now(), subview, redirectOrigin });
      
      const authUrl = googleOAuthService.getAuthUrl(state);
      
      return reply.redirect(authUrl);
    }
  );

  // Intentionally Public: OAuth Callback redirect from Google OAuth consent screen
  fastify.get('/google/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    const stateData = query.state ? stateStore.get(query.state) : null;
    const redirectOrigin = stateData?.redirectOrigin || process.env.FRONTEND_URL || 'http://localhost:3000';

    if (query.error) {
      if (query.state) stateStore.delete(query.state);
      return reply.redirect(`${redirectOrigin}/integrations?error=oauth_denied`);
    }

    if (!query.code || !query.state) {
      return reply.status(400).send({ error: 'Missing code or state' });
    }

    // Validate state token
    if (!stateData) {
      return reply.status(400).send({ error: 'Invalid or expired state token' });
    }
    
    // Check expiration (10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      stateStore.delete(query.state);
      return reply.status(400).send({ error: 'State token expired' });
    }
    
    const subview = stateData.subview || 'ga4';
    stateStore.delete(query.state); // Single use

    try {
      const tokens = await googleOAuthService.getTokens(query.code);
      
      if (tokens.access_token) {
        const config = { expiryDate: tokens.expiry_date };
        await integrationsService.saveCredentials('ga4', tokens.access_token, tokens.refresh_token || null, config, undefined, false);
        await integrationsService.saveCredentials('gsc', tokens.access_token, tokens.refresh_token || null, config, undefined, false);
        await integrationsService.saveCredentials('google-ads', tokens.access_token, tokens.refresh_token || null, config, undefined, false);
        await integrationsService.saveCredentials('google-business', tokens.access_token, tokens.refresh_token || null, config, undefined, false);
        
        return reply.redirect(`${redirectOrigin}/integrations?subview=${subview}&connected=true`);
      } else {
        return reply.status(400).send({ error: 'No access token returned from Google' });
      }
    } catch (err: any) {
      return reply.redirect(`${redirectOrigin}/integrations?error=token_exchange_failed`);
    }
  });

  // Protected: GA4 analytics query (requires 'analytics' or 'integrations' permission)
  fastify.get(
    '/google/analytics',
    { preHandler: [authorize(['analytics', 'integrations'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      try {
        const overview = await ga4Service.getOverview(startDate || '30daysAgo', endDate || 'today');
        const landingPages = await ga4Service.getLandingPagesReport(startDate || '30daysAgo', endDate || 'today');
        return reply.send({
          success: true,
          data: {
            overview,
            landingPages
          }
        });
      } catch (error: any) {
        fastify.log.error(`GA4 report fetch failed: ${error.message || error}`);
        return reply.status(500).send({
          success: false,
          error: error.message || 'Failed to fetch GA4 report'
        });
      }
    }
  );
}
