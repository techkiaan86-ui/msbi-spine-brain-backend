import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { microsoftGraphService } from '../services/microsoft-graph.service';
import { integrationsService } from '../services/integrations.service';
import { authorize } from '../middlewares/rbac.middleware';

export default async function outlookOAuthRoutes(fastify: FastifyInstance) {
  // Protected: Start Microsoft Outlook OAuth 2.0 flow
  fastify.get(
    '/outlook/oauth/start',
    { preHandler: [authorize('integrations')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id || 'admin';
      const query = request.query as { subview?: string; redirect_origin?: string };
      const subview = query.subview || 'microsoft_outlook';
      const redirectOrigin = query.redirect_origin || process.env.FRONTEND_URL || 'http://localhost:3000';

      try {
        const state = await microsoftGraphService.generateAndSaveStateToken(userId, subview, redirectOrigin);
        const authUrl = microsoftGraphService.getAuthUrl(state);
        return reply.redirect(authUrl);
      } catch (err: any) {
        fastify.log.error(`Failed to initiate Microsoft OAuth: ${err.message}`);
        return reply.status(500).send({ error: 'Failed to initiate Microsoft OAuth: ' + err.message });
      }
    }
  );

  // Intentionally Public: OAuth Callback redirect from Microsoft Entra ID consent screen
  fastify.get('/outlook/oauth/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };

    if (!query.state) {
      const defaultOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
      return reply.redirect(`${defaultOrigin}/integrations?error=missing_state`);
    }

    const stateData = await microsoftGraphService.validateAndConsumeStateToken(query.state);
    const redirectOrigin = stateData?.redirectOrigin || process.env.FRONTEND_URL || 'http://localhost:3000';

    if (query.error) {
      fastify.log.warn(`Microsoft OAuth consent denied: ${query.error_description || query.error}`);
      return reply.redirect(`${redirectOrigin}/integrations?subview=microsoft_outlook&error=oauth_denied`);
    }

    if (!query.code) {
      return reply.redirect(`${redirectOrigin}/integrations?subview=microsoft_outlook&error=missing_code`);
    }

    if (!stateData) {
      return reply.redirect(`${redirectOrigin}/integrations?subview=microsoft_outlook&error=invalid_or_expired_state`);
    }

    const subview = stateData.subview || 'microsoft_outlook';

    try {
      const tokens = await microsoftGraphService.exchangeCodeForTokens(query.code);

      if (tokens.accessToken) {
        const config = {
          userEmail: tokens.userEmail,
          displayName: tokens.displayName,
          expiresAt: tokens.expiresAt,
          tenantId: process.env.MICROSOFT_TENANT_ID || 'common'
        };

        await integrationsService.saveCredentials(
          'microsoft_outlook',
          tokens.accessToken,
          tokens.refreshToken,
          config,
          undefined,
          false
        );

        fastify.log.info(`Microsoft Outlook connected successfully for mailbox: ${tokens.userEmail}`);
        return reply.redirect(`${redirectOrigin}/integrations?subview=${subview}&connected=true`);
      } else {
        return reply.redirect(`${redirectOrigin}/integrations?subview=${subview}&error=no_access_token`);
      }
    } catch (err: any) {
      fastify.log.error(`Microsoft token exchange failed: ${err.message}`);
      return reply.redirect(`${redirectOrigin}/integrations?subview=${subview}&error=token_exchange_failed`);
    }
  });
}
