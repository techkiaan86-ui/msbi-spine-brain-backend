import axios from 'axios';
import crypto from 'crypto';
import prisma from '../plugins/db';
import { integrationsService } from './integrations.service';

export interface EmailAttachment {
  name: string;
  contentType: string;
  contentBytes: string; // Base64 string
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
}

export class MicrosoftGraphService {
  private getTenantId(): string {
    return process.env.MICROSOFT_TENANT_ID || 'common';
  }

  private getClientId(): string {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
      throw new Error('MICROSOFT_CLIENT_ID environment variable is missing.');
    }
    return clientId;
  }

  private getClientSecret(): string {
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientSecret) {
      throw new Error('MICROSOFT_CLIENT_SECRET environment variable is missing.');
    }
    return clientSecret;
  }

  private getRedirectUri(): string {
    return process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:8000/api/v1/integrations/outlook/oauth/callback';
  }

  /**
   * Generates a cryptographically random OAuth state token and persists it in the database.
   * This ensures state survival across backend server restarts, deploys, or horizontal instances.
   */
  async generateAndSaveStateToken(userId: string, subview?: string, redirectOrigin?: string): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    const platformName = `oauth_state:microsoft_outlook:${state}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

    await prisma.integrationCredential.upsert({
      where: { platformName },
      update: {
        isActive: true,
        config: {
          userId,
          subview: subview || 'microsoft_outlook',
          redirectOrigin: redirectOrigin || process.env.FRONTEND_URL || 'http://localhost:3000',
          expiresAt: expiresAt.getTime()
        }
      },
      create: {
        platformName,
        isActive: true,
        config: {
          userId,
          subview: subview || 'microsoft_outlook',
          redirectOrigin: redirectOrigin || process.env.FRONTEND_URL || 'http://localhost:3000',
          expiresAt: expiresAt.getTime()
        }
      }
    });

    return state;
  }

  /**
   * Validates and consumes the OAuth state token from the database (single-use).
   */
  async validateAndConsumeStateToken(state: string): Promise<{ userId: string; subview: string; redirectOrigin: string } | null> {
    const platformName = `oauth_state:microsoft_outlook:${state}`;
    const record = await prisma.integrationCredential.findUnique({
      where: { platformName }
    });

    if (!record) {
      return null;
    }

    // Immediately delete state record to ensure single-use (replay prevention)
    try {
      await prisma.integrationCredential.delete({
        where: { platformName }
      });
    } catch (e) {
      // Ignore record missing on delete
    }

    const config = record.config as any;
    if (!config || !config.expiresAt) {
      return null;
    }

    if (Date.now() > config.expiresAt) {
      return null; // Expired
    }

    return {
      userId: config.userId,
      subview: config.subview || 'microsoft_outlook',
      redirectOrigin: config.redirectOrigin || process.env.FRONTEND_URL || 'http://localhost:3000'
    };
  }

  /**
   * Constructs the Microsoft Entra ID OAuth 2.0 authorization URL.
   */
  getAuthUrl(state: string): string {
    const tenantId = this.getTenantId();
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    const scopes = ['Mail.Send', 'User.Read', 'offline_access'].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: scopes,
      state: state
    });

    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for access & refresh tokens.
   */
  async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string; userEmail: string; displayName: string; expiresAt: number }> {
    const tenantId = this.getTenantId();
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const redirectUri = this.getRedirectUri();

    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      scope: 'Mail.Send User.Read offline_access',
      code: code,
      redirect_uri: redirectUri,
      client_secret: clientSecret
    });

    const tokenRes = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Fetch user profile to identify connected Microsoft 365 mailbox
    const profileRes = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const userEmail = profileRes.data.mail || profileRes.data.userPrincipalName;
    const displayName = profileRes.data.displayName || userEmail;
    const expiresAt = Date.now() + (expires_in * 1000);

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      userEmail,
      displayName,
      expiresAt
    };
  }

  /**
   * Refreshes the Microsoft Graph access token using the stored refresh token.
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
    const tenantId = this.getTenantId();
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      scope: 'Mail.Send User.Read offline_access',
      refresh_token: refreshToken,
      client_secret: clientSecret
    });

    const tokenRes = await axios.post(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token: new_refresh_token, expires_in } = tokenRes.data;
    const expiresAt = Date.now() + (expires_in * 1000);

    return {
      accessToken: access_token,
      refreshToken: new_refresh_token || refreshToken,
      expiresAt
    };
  }

  /**
   * Retrieves active, decrypted Microsoft Outlook credentials from database, automatically handling token refresh.
   */
  async getValidAccessToken(): Promise<string> {
    const creds = await integrationsService.getSecureCredentials('microsoft_outlook');
    if (!creds || !creds.accessToken) {
      throw new Error('Microsoft Outlook is not connected. Please connect Microsoft Outlook in Integrations before sending emails.');
    }

    const { accessToken, refreshToken, config } = creds;

    // Check if token expires within 5 minutes
    const expiresAt = config?.expiresAt || 0;
    const isExpired = Date.now() >= (expiresAt - 5 * 60 * 1000);

    if (!isExpired) {
      return accessToken;
    }

    if (!refreshToken) {
      throw new Error('Microsoft Outlook authorization has expired and no refresh token is available. Please reconnect Microsoft Outlook in Integrations.');
    }

    try {
      const refreshed = await this.refreshAccessToken(refreshToken);
      const updatedConfig = {
        ...config,
        expiresAt: refreshed.expiresAt
      };

      await integrationsService.saveCredentials(
        'microsoft_outlook',
        refreshed.accessToken,
        refreshed.refreshToken || refreshToken,
        updatedConfig,
        undefined,
        false
      );

      return refreshed.accessToken;
    } catch (err: any) {
      console.error('[MICROSOFT GRAPH TOKEN REFRESH FAILED]:', err.response?.data?.error_description || err.message);
      throw new Error('Failed to refresh Microsoft Outlook token. Please reconnect Microsoft Outlook in Integrations.');
    }
  }

  /**
   * Sends an email via Microsoft Graph API (me/sendMail).
   */
  async sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string }> {
    const { to, subject, html, text, cc, bcc, attachments } = params;
    const accessToken = await this.getValidAccessToken();

    const formatRecipients = (recipients?: string | string[]) => {
      if (!recipients) return undefined;
      const list = Array.isArray(recipients) ? recipients : [recipients];
      return list.map(email => ({
        emailAddress: { address: email.trim() }
      }));
    };

    const toRecipients = formatRecipients(to);
    if (!toRecipients || toRecipients.length === 0) {
      throw new Error('Recipient email address ("to") is required.');
    }

    const graphMessage: any = {
      subject: subject,
      body: {
        contentType: html ? 'HTML' : 'Text',
        content: html || text || ''
      },
      toRecipients: toRecipients
    };

    const ccRecipients = formatRecipients(cc);
    if (ccRecipients && ccRecipients.length > 0) {
      graphMessage.ccRecipients = ccRecipients;
    }

    const bccRecipients = formatRecipients(bcc);
    if (bccRecipients && bccRecipients.length > 0) {
      graphMessage.bccRecipients = bccRecipients;
    }

    if (attachments && attachments.length > 0) {
      graphMessage.attachments = attachments.map(att => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.name,
        contentType: att.contentType,
        contentBytes: att.contentBytes
      }));
    }

    const payload = {
      message: graphMessage,
      saveToSentItems: true
    };

    try {
      await axios.post('https://graph.microsoft.com/v1.0/me/sendMail', payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`[MICROSOFT GRAPH EMAIL] Email sent successfully to ${Array.isArray(to) ? to.join(', ') : to}`);
      
      // Update last successful sync timestamp
      await prisma.integrationCredential.update({
        where: { platformName: 'microsoft_outlook' },
        data: {
          lastSuccessfulSyncAt: new Date(),
          lastSyncAt: new Date(),
          lastError: null
        }
      }).catch(() => {});

      return { success: true };
    } catch (err: any) {
      const errorMsg = err.response?.data?.error?.message || err.message;
      console.error('[MICROSOFT GRAPH EMAIL FAILED]:', errorMsg);

      await prisma.integrationCredential.update({
        where: { platformName: 'microsoft_outlook' },
        data: {
          lastSyncAt: new Date(),
          lastError: errorMsg
        }
      }).catch(() => {});

      throw new Error(`Microsoft Outlook email delivery failed: ${errorMsg}`);
    }
  }
}

export const microsoftGraphService = new MicrosoftGraphService();
