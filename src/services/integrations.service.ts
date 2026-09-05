import prisma from '../plugins/db';
import { SyncIntegrationInput } from '../validators/integrations.schema';
import { encryptCredential, decryptCredential } from '../utils/crypto';
import { wordpressService } from './wordpress.service';
import { googleAdsService } from './google-ads.service';

// The expected baseline of providers the frontend can connect to
const KNOWN_PROVIDERS = [
  'ga4',
  'google-ads',
  'meta-ads',
  'gsc',
  'looker',
  'callrail',
  'hubspot',
  'mailchimp',
  'google-business',
  'custom-api',
  'wordpress',
  'microsoft_outlook'
];

export class IntegrationsService {
  async getStatus() {
    const credentials = await prisma.integrationCredential.findMany({
      select: {
        platformName: true,
        isActive: true,
        lastSyncAt: true,
        lastSuccessfulSyncAt: true,
        lastError: true,
        updatedAt: true,
        accessToken: true,
        apiKey: true,
        config: true
      },
    });

    const dbMap = new Map(credentials.map(c => [c.platformName, c]));

    // Construct a normalized list for the frontend
    const statuses = await Promise.all(KNOWN_PROVIDERS.map(async provider => {
      const dbRecord = dbMap.get(provider);
      
      let isConnected = !!(dbRecord && dbRecord.isActive && (dbRecord.accessToken || dbRecord.apiKey));
      
      if (provider === 'google-ads') {
        const hasCredentials = !!(dbRecord && dbRecord.isActive && dbRecord.accessToken);
        const hasCustomerId = !!(process.env.GOOGLE_ADS_CUSTOMER_ID || (dbRecord?.config as any)?.customerId);
        isConnected = hasCredentials && hasCustomerId;
      }

      let status = 'not_connected';

      if (provider === 'wordpress') {
        isConnected = !!(dbRecord && dbRecord.isActive);
        if (isConnected) {
          status = dbRecord?.lastError ? 'error' : 'connected';
        } else {
          status = 'not_connected';
        }
      } else if (isConnected) {
        if (dbRecord?.lastError) {
          status = 'error';
        } else {
          status = 'connected';
        }
      }

      return {
        id: provider,
        connected: isConnected,
        status,
        lastSyncAt: dbRecord?.lastSyncAt || null,
        lastSuccessfulSyncAt: dbRecord?.lastSuccessfulSyncAt || null,
        lastError: dbRecord?.lastError || null,
        updatedAt: dbRecord?.updatedAt || null,
        config: dbRecord?.config || null
      };
    }));

    return statuses;
  }
  
  async verifyWordPressHealth() {
    const isHealthy = await wordpressService.healthCheck();
    if (isHealthy) {
      await prisma.integrationCredential.upsert({
        where: { platformName: 'wordpress' },
        update: {
          isActive: true,
          lastSuccessfulSyncAt: new Date(),
          lastSyncAt: new Date(),
          lastError: null,
          config: { baseUrl: 'https://midwestspine.net' }
        },
        create: {
          platformName: 'wordpress',
          isActive: true,
          lastSuccessfulSyncAt: new Date(),
          lastSyncAt: new Date(),
          config: { baseUrl: 'https://midwestspine.net' }
        }
      });
      return { success: true };
    } else {
      await prisma.integrationCredential.upsert({
        where: { platformName: 'wordpress' },
        update: {
          lastSyncAt: new Date(),
          lastError: 'WordPress health check failed'
        },
        create: {
          platformName: 'wordpress',
          isActive: false,
          lastSyncAt: new Date(),
          lastError: 'WordPress health check failed'
        }
      });
      return { success: false, error: 'WordPress health check failed' };
    }
  }
  
  /**
   * Internal method to safely save credentials
   */
  async saveCredentials(platformName: string, accessToken: string | null, refreshToken?: string | null, apiKeyOrConfig?: string | any, config?: any, resetConfig = false) {
    let apiKey: string | null = null;
    let actualConfig: any = null;

    if (apiKeyOrConfig) {
      if (typeof apiKeyOrConfig === 'string') {
        apiKey = apiKeyOrConfig;
      } else {
        actualConfig = apiKeyOrConfig;
      }
    }

    if (config) {
      actualConfig = config;
    }

    // Retrieve existing credentials to preserve the refresh token and merge configs
    let finalRefreshToken = refreshToken;
    let finalConfig = actualConfig;
    
    const existing = await prisma.integrationCredential.findUnique({
      where: { platformName },
      select: { refreshToken: true, config: true }
    });
    
    if (!finalRefreshToken && existing?.refreshToken) {
      finalRefreshToken = decryptCredential(existing.refreshToken);
    }
    
    if (existing?.config && !resetConfig) {
      finalConfig = {
        ...(existing.config as any),
        ...actualConfig
      };
    }

    const encryptedAccess = encryptCredential(accessToken);
    const encryptedRefresh = encryptCredential(finalRefreshToken);
    const encryptedApi = encryptCredential(apiKey);
    
    return prisma.integrationCredential.upsert({
      where: { platformName },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        apiKey: encryptedApi,
        config: finalConfig !== null ? finalConfig : undefined,
        isActive: true
      },
      create: {
        platformName,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        apiKey: encryptedApi,
        config: finalConfig !== null ? finalConfig : undefined,
        isActive: true
      }
    });
  }
  
  /**
   * Internal method to retrieve credentials securely for API calls
   */
  async getSecureCredentials(platformName: string) {
    const record = await prisma.integrationCredential.findUnique({
      where: { platformName }
    });
    
    if (!record || !record.isActive) return null;
    
    return {
      accessToken: decryptCredential(record.accessToken),
      refreshToken: decryptCredential(record.refreshToken),
      apiKey: decryptCredential(record.apiKey),
      config: record.config as any
    };
  }

  async triggerSync(data: SyncIntegrationInput) {
    if (data.platformName === 'GOOGLE_ADS') {
      try {
        const campaigns = await googleAdsService.listCampaigns();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const endDate = new Date();
        
        const metrics = await googleAdsService.getCampaignMetricsByDateRange(
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0]
        );
        
        const { campaignsService } = require('./campaigns.service');
        await campaignsService.upsertExternalCampaigns(campaigns, metrics);
      } catch (err: any) {
        console.error('Manual sync failed for Google Ads:', err.message);
        throw err;
      }
    }
    // In a real app, this would queue a job to fetch data from the external API
    return {
      message: `Manual sync triggered for ${data.platformName}.`,
      status: 'IN_PROGRESS',
    };
  }
}

export const integrationsService = new IntegrationsService();
