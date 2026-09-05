import axios from 'axios';
import { integrationsService } from './integrations.service';
import { googleOAuthService } from './google.service';

export class GoogleAdsService {
  private getApiVersion(): string {
    return process.env.GOOGLE_ADS_API_VERSION || 'v25';
  }

  private getDeveloperToken(): string {
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken || developerToken === 'mock-developer-token') {
      throw new Error('Google Ads Developer Token (GOOGLE_ADS_DEVELOPER_TOKEN) is missing or set to mock in environment configuration');
    }
    return developerToken;
  }

  private async getClient() {
    const creds = await integrationsService.getSecureCredentials('google-ads');
    if (!creds?.accessToken) {
      throw new Error('Google Ads authorization required (AccessToken missing)');
    }

    try {
      const config = creds.config as any;
      const { client, onTokens } = await googleOAuthService.getAuthenticatedClient(creds.accessToken, creds.refreshToken, config?.expiryDate);

      onTokens(async (tokens) => {
        if (tokens.access_token) {
          console.log('[GOOGLE ADS SERVICE] Tokens updated/refreshed automatically. Saving new credentials...');
          const newRefreshToken = tokens.refresh_token || creds.refreshToken;
          const newConfig = { ...config, expiryDate: tokens.expiry_date };
          await integrationsService.saveCredentials('google-ads', tokens.access_token, newRefreshToken, newConfig);
          console.log('[GOOGLE ADS SERVICE] Refreshed credentials saved.');
        }
      });

      return client;
    } catch (error: any) {
      console.error('[GOOGLE ADS SERVICE] Authenticated client retrieval failed:', error.message || error);
      throw new Error('Google Ads authorization required');
    }
  }

  private async getClientInfo() {
    const developerToken = this.getDeveloperToken();
    
    const creds = await integrationsService.getSecureCredentials('google-ads');
    if (!creds || !creds.accessToken) {
      throw new Error('Google Ads OAuth credentials not found. Please connect Google Ads first.');
    }

    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || creds.config?.customerId;
    if (!customerId) {
      throw new Error('Google Ads Customer ID is missing. Please configure it in environment variables or Integrations panel.');
    }

    const client = await this.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes.token || client.credentials.access_token;
    if (!accessToken) {
      throw new Error('Could not retrieve active Google Ads access token');
    }

    // Strip hyphens as Google Ads API requests require numeric strings only
    const cleanCustomerId = customerId.replace(/-/g, '').trim();
    const rawLoginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || creds.config?.loginCustomerId;
    const cleanLoginCustomerId = rawLoginCustomerId ? rawLoginCustomerId.replace(/-/g, '').trim() : undefined;

    return {
      accessToken,
      developerToken,
      customerId: cleanCustomerId,
      loginCustomerId: cleanLoginCustomerId,
    };
  }

  async setConfig(customerId: string, loginCustomerId?: string | null) {
    const creds = await integrationsService.getSecureCredentials('google-ads');
    if (!creds?.accessToken) {
      throw new Error('Google Ads must be authorized with Google before saving configuration.');
    }

    const config = (creds.config as any) || {};
    config.customerId = customerId.trim();
    if (loginCustomerId !== undefined) {
      config.loginCustomerId = loginCustomerId ? loginCustomerId.trim() : null;
    }

    await integrationsService.saveCredentials('google-ads', creds.accessToken, creds.refreshToken || null, config);
  }

  async getConfig() {
    const customerIdFromEnv = process.env.GOOGLE_ADS_CUSTOMER_ID || null;
    const loginCustomerIdFromEnv = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null;

    const creds = await integrationsService.getSecureCredentials('google-ads');
    const config = (creds?.config as any) || {};

    const activeCustomerId = customerIdFromEnv || config.customerId || null;
    const activeLoginCustomerId = loginCustomerIdFromEnv || config.loginCustomerId || null;

    return {
      customerId: activeCustomerId,
      loginCustomerId: activeLoginCustomerId,
      isConfigured: !!activeCustomerId,
    };
  }

  private handleApiError(error: any, context: string): never {
    const endpoint = error.config?.url || 'unknown endpoint';
    const status = error.response?.status || error.response?.data?.error?.status || 'unknown status';

    if (error.response?.data?.error) {
      const apiError = error.response.data.error;
      let detailedMessage = apiError.message || 'Request failed';
      
      const details = apiError.details;
      if (Array.isArray(details)) {
        for (const detail of details) {
          if (detail.errors && Array.isArray(detail.errors)) {
            for (const subError of detail.errors) {
              if (subError.message) {
                detailedMessage += ` (${subError.message})`;
              }
            }
          }
        }
      }
      
      console.error(`Google Ads API Failure during ${context} at endpoint ${endpoint} (Status ${status}):`, error.response.data);
      throw new Error(`Google Ads API Error: Status ${status} on endpoint ${endpoint} - ${detailedMessage}`);
    }
    
    console.error(`Google Ads connection error during ${context} at endpoint ${endpoint}:`, error.message || error);
    throw new Error(`Google Ads connection failed: Status ${status} on endpoint ${endpoint} - ${error.message || error}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClientInfo();
      if (!client) return false;

      // Make a lightweight call to verify access to the customer account
      const url = `https://googleads.googleapis.com/${this.getApiVersion()}/customers/${client.customerId}`;
      
      const headers: any = {
        'Authorization': `Bearer ${client.accessToken}`,
        'developer-token': client.developerToken,
      };
      
      if (client.loginCustomerId) {
        headers['login-customer-id'] = client.loginCustomerId;
      }

      await axios.get(url, { headers });
      return true;
    } catch (error: any) {
      console.error('Google Ads healthCheck failed:', error.response?.data || error.message);
      return false;
    }
  }

  async listCampaigns() {
    const client = await this.getClientInfo();
    if (!client) throw new Error('Google Ads not connected or missing configuration');

    const url = `https://googleads.googleapis.com/${this.getApiVersion()}/customers/${client.customerId}/googleAds:search`;
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `;

    const headers: any = {
      'Authorization': `Bearer ${client.accessToken}`,
      'developer-token': client.developerToken,
      'Content-Type': 'application/json'
    };

    if (client.loginCustomerId) {
      headers['login-customer-id'] = client.loginCustomerId;
    }

    try {
      const res = await axios.post(url, { query }, { headers });
      
      return (res.data.results || []).map((row: any) => ({
        platform: 'google_ads',
        externalId: String(row.campaign.id),
        name: row.campaign.name,
        status: row.campaign.status,
        startDate: row.campaign.startDate,
        endDate: row.campaign.endDate,
      }));
    } catch (error: any) {
      this.handleApiError(error, 'listCampaigns');
    }
  }

  async getCampaignMetricsByDateRange(startDate: string, endDate: string) {
    const client = await this.getClientInfo();
    if (!client) throw new Error('Google Ads not connected or missing configuration');

    const url = `https://googleads.googleapis.com/${this.getApiVersion()}/customers/${client.customerId}/googleAds:search`;
    
    // Group metrics by campaign id and date
    const query = `
      SELECT
        campaign.id,
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    const headers: any = {
      'Authorization': `Bearer ${client.accessToken}`,
      'developer-token': client.developerToken,
      'Content-Type': 'application/json'
    };

    if (client.loginCustomerId) {
      headers['login-customer-id'] = client.loginCustomerId;
    }

    try {
      const res = await axios.post(url, { query }, { headers });
      
      return (res.data.results || []).map((row: any) => {
        return {
          externalId: String(row.campaign.id),
          date: row.segments.date,
          impressions: parseInt(row.metrics.impressions || '0', 10),
          clicks: parseInt(row.metrics.clicks || '0', 10),
          // Convert cost_micros to standard currency
          spend: parseFloat(row.metrics.costMicros || '0') / 1_000_000,
          conversions: row.metrics.conversions ? parseFloat(row.metrics.conversions) : null,
          conversionValue: row.metrics.conversionsValue ? parseFloat(row.metrics.conversionsValue) : null,
          currencyCode: 'USD',
        };
      });
    } catch (error: any) {
      this.handleApiError(error, 'getCampaignMetricsByDateRange');
    }
  }
}

export const googleAdsService = new GoogleAdsService();
