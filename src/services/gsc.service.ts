import { google } from 'googleapis';
import { googleOAuthService } from './google.service';
import { integrationsService } from './integrations.service';

export class GSCService {
  private async getClient() {
    const creds = await integrationsService.getSecureCredentials('gsc');
    if (!creds?.accessToken) {
      throw new Error('GSC not connected');
    }
    const config = creds.config as any;
    const { client, onTokens } = await googleOAuthService.getAuthenticatedClient(creds.accessToken, creds.refreshToken, config?.expiryDate);
    
    onTokens(async (tokens) => {
      if (tokens.access_token) {
        const newRefreshToken = tokens.refresh_token || creds.refreshToken;
        const newConfig = { ...config, expiryDate: tokens.expiry_date };
        await integrationsService.saveCredentials('gsc', tokens.access_token, newRefreshToken, newConfig);
      }
    });

    return client;
  }

  async getSites() {
    const client = await this.getClient();
    const searchconsole = google.searchconsole({ version: 'v1', auth: client });
    const response = await searchconsole.sites.list();
    return response.data.siteEntry || [];
  }

  async healthCheck() {
    try {
      const creds = await integrationsService.getSecureCredentials('gsc');
      if (!creds?.accessToken) return false;
      
      const config = creds.config as any;
      if (!config?.siteUrl) return false;

      const client = await this.getClient();
      const searchconsole = google.searchconsole({ version: 'v1', auth: client });
      
      // Basic health check to see if we can access the selected site
      await searchconsole.sites.get({ siteUrl: config.siteUrl });
      return true;
    } catch (error) {
      console.error('GSC Health Check Failed:', error);
      return false;
    }
  }

  async setSiteUrl(siteUrl: string) {
    const creds = await integrationsService.getSecureCredentials('gsc');
    if (!creds?.accessToken) throw new Error('Not connected');
    
    const config = creds.config as any || {};
    config.siteUrl = siteUrl;
    
    await integrationsService.saveCredentials('gsc', creds.accessToken, creds.refreshToken || null, config);
  }

  async runQuery(startDate = '30daysAgo', endDate = 'today', dimensions = ['query']) {
    const creds = await integrationsService.getSecureCredentials('gsc');
    if (!creds?.accessToken) return null;
    
    const config = creds.config as any;
    if (!config?.siteUrl) return null;

    const client = await this.getClient();
    const searchconsole = google.searchconsole({ version: 'v1', auth: client });
    
    // GSC requires explicit YYYY-MM-DD formatting.
    // If startDate is generic like '30daysAgo', we parse it.
    let start = startDate;
    let end = endDate;
    if (startDate === '30daysAgo') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      start = d.toISOString().split('T')[0];
    }
    if (endDate === 'today') {
      end = new Date().toISOString().split('T')[0];
    }

    try {
      const response = await searchconsole.searchanalytics.query({
        siteUrl: config.siteUrl,
        requestBody: {
          startDate: start,
          endDate: end,
          dimensions
        }
      });
      return response.data.rows || [];
    } catch (error) {
      console.error('GSC runQuery error:', error);
      return null;
    }
  }
}

export const gscService = new GSCService();
