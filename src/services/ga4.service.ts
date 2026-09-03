import { google } from 'googleapis';
import { googleOAuthService } from './google.service';
import { integrationsService } from './integrations.service';

export class GA4Service {
  private async getPropertyId() {
    const creds = await integrationsService.getSecureCredentials('ga4');
    const config = creds?.config as any;
    if (config?.propertyId) {
      return config.propertyId;
    }
    if (process.env.GOOGLE_GA4_PROPERTY_ID) {
      return process.env.GOOGLE_GA4_PROPERTY_ID;
    }
    return null;
  }

  private async getClient() {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    console.log('[GA4 SERVICE] Loading credentials from secure store...');
    const creds = await integrationsService.getSecureCredentials('ga4');
    if (!creds?.accessToken) {
      console.error('[GA4 SERVICE] Load failed: accessToken is missing. Authorization required.');
      throw new Error('Google Analytics authorization required');
    }
    console.log('[GA4 SERVICE] Credentials loaded successfully. Refresh token present:', !!creds.refreshToken);
    
    try {
      console.log('[GA4 SERVICE] Retrieving authenticated OAuth2Client...');
      const config = creds.config as any;
      const { client, onTokens } = await googleOAuthService.getAuthenticatedClient(creds.accessToken, creds.refreshToken, config?.expiryDate);
      
      onTokens(async (tokens) => {
        if (tokens.access_token) {
          console.log('[GA4 SERVICE] Tokens updated/refreshed automatically. Saving new credentials...');
          const newRefreshToken = tokens.refresh_token || creds.refreshToken;
          const newConfig = { ...config, expiryDate: tokens.expiry_date };
          await integrationsService.saveCredentials('ga4', tokens.access_token, newRefreshToken, newConfig);
          console.log('[GA4 SERVICE] Refreshed credentials saved.');
        }
      });

      return client;
    } catch (error) {
      console.error('[GA4 SERVICE] Authenticated client retrieval failed:', error);
      throw new Error('Google Analytics authorization required');
    }
  }

  async getProperties() {
    const client = await this.getClient();
    const adminApi = google.analyticsadmin({ version: 'v1beta', auth: client });
    const response = await adminApi.accountSummaries.list();
    const summaries = response.data.accountSummaries || [];
    
    const properties: any[] = [];
    for (const account of summaries) {
      if (account.propertySummaries) {
        for (const prop of account.propertySummaries) {
          const propId = prop.property?.replace(/^properties\//, '') || '';
          properties.push({
            name: prop.property,
            property: prop.property,
            displayName: `GA4 Property (${propId})`
          });
        }
      }
    }
    return properties;
  }

  async healthCheck() {
    try {
      const propertyId = await this.getPropertyId();
      if (!propertyId) return false;

      await this.runReport([], ['activeUsers'], 'today', 'today');
      return true;
    } catch (error) {
      console.error('GA4 Health Check Failed:', error);
      return false;
    }
  }

  async setPropertyId(propertyId: string) {
    const creds = await integrationsService.getSecureCredentials('ga4');
    if (!creds?.accessToken) throw new Error('Not connected');
    
    const config = creds.config as any || {};
    config.propertyId = propertyId;
    
    await integrationsService.saveCredentials('ga4', creds.accessToken, creds.refreshToken || null, config);
  }

  async runReport(dimensions: string[], metrics: string[], startDate = '30daysAgo', endDate = 'today') {
    const propertyId = await this.getPropertyId();
    if (!propertyId) {
      throw new Error('GOOGLE_GA4_PROPERTY_ID is not configured in .env and not found in database');
    }
    const cleanPropertyId = propertyId.replace(/^properties\//, '');
    console.log(`[GA4 SERVICE] Running report for properties/${cleanPropertyId} [Metrics: ${metrics.join(', ')}]`);
    
    try {
      const oauth2Client = await this.getClient();
      const analyticsData = google.analyticsdata({
        version: 'v1beta',
        auth: oauth2Client
      });

      const response = await analyticsData.properties.runReport({
        property: `properties/${cleanPropertyId}`,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: dimensions.map(d => ({ name: d })),
          metrics: metrics.map(m => ({ name: m }))
        }
      });

      const rowsCount = response.data.rows?.length || 0;
      console.log(`[GA4 SERVICE] Report request succeeded. Property: properties/${cleanPropertyId}. Rows returned: ${rowsCount}`);
      return response.data;
    } catch (error: any) {
      const isUnauthenticated = error.code === 16 || 
        error.code === 401 ||
        error.message?.includes('UNAUTHENTICATED') || 
        error.message?.includes('invalid authentication credentials') ||
        error.message?.includes('invalid_grant');
        
      if (isUnauthenticated) {
        console.log('[GA4 SERVICE] Request failed with unauthenticated error. Attempting manual token refresh...');
        try {
          const oauth2Client = await this.getClient();
          if (oauth2Client.credentials.refresh_token) {
            console.log('[GA4 SERVICE] Refresh token found. Refreshing access token...');
            const refreshRes = await oauth2Client.refreshAccessToken();
            const newAccessToken = refreshRes.credentials.access_token;
            if (newAccessToken) {
              console.log('[GA4 SERVICE] Token refresh successful. Saving new credentials...');
              const creds = await integrationsService.getSecureCredentials('ga4');
              const newRefreshToken = refreshRes.credentials.refresh_token || creds?.refreshToken;
              const newConfig = { ...(creds?.config as any), expiryDate: refreshRes.credentials.expiry_date };
              await integrationsService.saveCredentials('ga4', newAccessToken, newRefreshToken || null, newConfig);
              
              // Retry the report with the new client
              console.log('[GA4 SERVICE] Retrying runReport with refreshed credentials...');
              const newOauth2Client = await this.getClient();
              const newAnalyticsData = google.analyticsdata({
                version: 'v1beta',
                auth: newOauth2Client
              });
              const response = await newAnalyticsData.properties.runReport({
                property: `properties/${cleanPropertyId}`,
                requestBody: {
                  dateRanges: [{ startDate, endDate }],
                  dimensions: dimensions.map(d => ({ name: d })),
                  metrics: metrics.map(m => ({ name: m }))
                }
              });
              const rowsCount = response.data.rows?.length || 0;
              console.log(`[GA4 SERVICE] Retried report request succeeded. Property: properties/${cleanPropertyId}. Rows returned: ${rowsCount}`);
              return response.data;
            }
          } else {
            console.warn('[GA4 SERVICE] No refresh token available. Cannot perform manual refresh.');
          }
        } catch (refreshErr: any) {
          console.error('[GA4 SERVICE] Manual token refresh or retry failed:', refreshErr);
        }
      }
      
      console.error(`[GA4 SERVICE] Report request failed. Property: properties/${cleanPropertyId}. Error Code: ${error.code || 'None'}. Error Message: ${error.message}`);
      const msg = error.message || '';
      // Map only token/key expiration issues to authorization prompts, letting real API errors pass through
      if (
        msg.includes('invalid_grant') ||
        msg.includes('Getting credentials failed') ||
        msg.includes('Getting metadata from plugin failed') ||
        msg.includes('key must be')
      ) {
        throw new Error('Google Analytics authorization required: token is invalid or expired.');
      }
      throw error;
    }
  }

  async runRealtimeReport(dimensions: string[], metrics: string[]) {
    const propertyId = await this.getPropertyId();
    if (!propertyId) {
      throw new Error('GOOGLE_GA4_PROPERTY_ID is not configured in .env and not found in database');
    }
    const cleanPropertyId = propertyId.replace(/^properties\//, '');
    console.log(`[GA4 SERVICE] Running realtime report for properties/${cleanPropertyId} [Metrics: ${metrics.join(', ')}]`);
    
    try {
      const oauth2Client = await this.getClient();
      const analyticsData = google.analyticsdata({
        version: 'v1beta',
        auth: oauth2Client
      });

      const response = await analyticsData.properties.runRealtimeReport({
        property: `properties/${cleanPropertyId}`,
        requestBody: {
          dimensions: dimensions.map(d => ({ name: d })),
          metrics: metrics.map(m => ({ name: m }))
        }
      });

      const rowsCount = response.data.rows?.length || 0;
      console.log(`[GA4 SERVICE] Realtime report request succeeded. Property: properties/${cleanPropertyId}. Rows returned: ${rowsCount}`);
      return response.data;
    } catch (error: any) {
      const isUnauthenticated = error.code === 16 || 
        error.code === 401 ||
        error.message?.includes('UNAUTHENTICATED') || 
        error.message?.includes('invalid authentication credentials') ||
        error.message?.includes('invalid_grant');
        
      if (isUnauthenticated) {
        console.log('[GA4 SERVICE] Realtime request failed with unauthenticated error. Attempting manual token refresh...');
        try {
          const oauth2Client = await this.getClient();
          if (oauth2Client.credentials.refresh_token) {
            console.log('[GA4 SERVICE] Refresh token found. Refreshing access token...');
            const refreshRes = await oauth2Client.refreshAccessToken();
            const newAccessToken = refreshRes.credentials.access_token;
            if (newAccessToken) {
              console.log('[GA4 SERVICE] Token refresh successful. Saving new credentials...');
              const creds = await integrationsService.getSecureCredentials('ga4');
              const newRefreshToken = refreshRes.credentials.refresh_token || creds?.refreshToken;
              const newConfig = { ...(creds?.config as any), expiryDate: refreshRes.credentials.expiry_date };
              await integrationsService.saveCredentials('ga4', newAccessToken, newRefreshToken || null, newConfig);
              
              // Retry the report with the new client
              console.log('[GA4 SERVICE] Retrying runRealtimeReport with refreshed credentials...');
              const newOauth2Client = await this.getClient();
              const newAnalyticsData = google.analyticsdata({
                version: 'v1beta',
                auth: newOauth2Client
              });
              const response = await newAnalyticsData.properties.runRealtimeReport({
                property: `properties/${cleanPropertyId}`,
                requestBody: {
                  dimensions: dimensions.map(d => ({ name: d })),
                  metrics: metrics.map(m => ({ name: m }))
                }
              });
              const rowsCount = response.data.rows?.length || 0;
              console.log(`[GA4 SERVICE] Retried realtime report request succeeded. Property: properties/${cleanPropertyId}. Rows returned: ${rowsCount}`);
              return response.data;
            }
          }
        } catch (refreshErr: any) {
          console.error('[GA4 SERVICE] Realtime manual token refresh or retry failed:', refreshErr);
        }
      }
      
      console.error(`[GA4 SERVICE] Realtime report request failed. Property: properties/${cleanPropertyId}. Error Code: ${error.code || 'None'}. Error Message: ${error.message}`);
      const msg = error.message || '';
      if (
        msg.includes('invalid_grant') ||
        msg.includes('Getting credentials failed') ||
        msg.includes('Getting metadata from plugin failed') ||
        msg.includes('key must be')
      ) {
        throw new Error('Google Analytics authorization required: token is invalid or expired.');
      }
      throw error;
    }
  }

  async getOverview(startDate = '30daysAgo', endDate = 'today') {
    // 1. Fetch historical metrics via runReport
    const historicalData = await this.runReport([], ['totalUsers', 'newUsers', 'sessions', 'engagedSessions'], startDate, endDate);
    
    // 2. Fetch realtime metrics via runRealtimeReport
    const realtimeData = await this.runRealtimeReport([], ['activeUsers', 'screenPageViews']);

    let totalUsers = 0;
    let newUsers = 0;
    let sessions = 0;
    let engagedSessions = 0;
    
    if (historicalData && historicalData.rows && historicalData.rows.length > 0) {
      const historicalMetrics = historicalData.rows[0].metricValues;
      totalUsers = parseInt(historicalMetrics?.[0]?.value || '0', 10);
      newUsers = parseInt(historicalMetrics?.[1]?.value || '0', 10);
      sessions = parseInt(historicalMetrics?.[2]?.value || '0', 10);
      engagedSessions = parseInt(historicalMetrics?.[3]?.value || '0', 10);
    }

    let activeUsers = 0;
    let screenPageViews = 0;
    
    if (realtimeData && realtimeData.rows && realtimeData.rows.length > 0) {
      const realtimeMetrics = realtimeData.rows[0].metricValues;
      activeUsers = parseInt(realtimeMetrics?.[0]?.value || '0', 10);
      screenPageViews = parseInt(realtimeMetrics?.[1]?.value || '0', 10);
    }

    return {
      totalUsers,
      activeUsers,
      newUsers,
      sessions,
      screenPageViews,
      engagedSessions
    };
  }

  async getLandingPagesReport(startDate = '30daysAgo', endDate = 'today') {
    const data = await this.runReport(['landingPage'], ['sessions', 'screenPageViews', 'bounceRate'], startDate, endDate);
    if (!data || !data.rows) return [];

    return data.rows.map((row: any) => {
      const path = row.dimensionValues?.[0]?.value || '/';
      const sessions = parseInt(row.metricValues?.[0]?.value || '0', 10);
      const pageviews = parseInt(row.metricValues?.[1]?.value || '0', 10);
      const bounceRate = parseFloat(row.metricValues?.[2]?.value || '0');

      return {
        path,
        sessions,
        pageviews,
        bounceRate
      };
    });
  }
}

export const ga4Service = new GA4Service();
