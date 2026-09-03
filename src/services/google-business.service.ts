import axios from 'axios';
import crypto from 'crypto';
import prisma from '../plugins/db';
import { integrationsService } from './integrations.service';
import { googleOAuthService } from './google.service';

interface SafeAccountMetadata {
  accountId: string;
  accountName: string;
  type: string;
}

interface SafeLocationMetadata {
  googleAccountId: string;
  businessAccountId: string;
  googleLocationId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  isVerified: boolean;
}

interface GbpAccountCacheEntry {
  accounts: SafeAccountMetadata[];
  expiresAt: number;
}

interface GbpLocationCacheEntry {
  locations: SafeLocationMetadata[];
  expiresAt: number;
}

// Global Singleton Cache Store (survives module reloads / instance re-creation)
class GbpSingletonStore {
  public accountsCache = new Map<string, GbpAccountCacheEntry>();
  public locationsCache = new Map<string, GbpLocationCacheEntry>();
  public pendingAccountsPromises = new Map<string, Promise<SafeAccountMetadata[]>>();
  public pendingLocationsPromises = new Map<string, Promise<SafeLocationMetadata[]>>();
  public cooldownUntilMap = new Map<string, number>(); // contextId -> timestamp
  public invocationCount = 0;
}

const GLOBAL_STORE_KEY = Symbol.for('SpineBrain.GbpSingletonStore');
const globalAny = globalThis as any;
if (!globalAny[GLOBAL_STORE_KEY]) {
  globalAny[GLOBAL_STORE_KEY] = new GbpSingletonStore();
}
const gbpStore: GbpSingletonStore = globalAny[GLOBAL_STORE_KEY];

export class GoogleBusinessService {
  private async getClientAndContext() {
    const creds = await integrationsService.getSecureCredentials('google-business');
    if (!creds?.accessToken) {
      throw new Error('Google Business Profile authorization required (AccessToken missing)');
    }

    try {
      const config = creds.config as any;
      const { client, onTokens } = await googleOAuthService.getAuthenticatedClient(creds.accessToken, creds.refreshToken, config?.expiryDate);

      onTokens(async (tokens) => {
        if (tokens.access_token) {
          console.log('[GOOGLE BUSINESS SERVICE] Tokens updated/refreshed automatically. Saving new credentials...');
          const newRefreshToken = tokens.refresh_token || creds.refreshToken;
          const newConfig = { ...config, expiryDate: tokens.expiry_date };
          await integrationsService.saveCredentials('google-business', tokens.access_token, newRefreshToken, newConfig);
          console.log('[GOOGLE BUSINESS SERVICE] Refreshed credentials saved.');
        }
      });

      // Generate safe context ID from credentials (masked SHA-256 hash)
      const tokenToHash = creds.refreshToken || creds.accessToken;
      const contextId = 'gbp_ctx_' + crypto.createHash('sha256').update(tokenToHash).digest('hex').substring(0, 12);

      return { client, accessToken: creds.accessToken, contextId };
    } catch (error: any) {
      console.error('[GOOGLE BUSINESS SERVICE] Authenticated client retrieval failed:', error.message || error);
      throw new Error('Google Business Profile authorization required');
    }
  }

  private async getClient() {
    const { client } = await this.getClientAndContext();
    return client;
  }

  private handleApiError(error: any, context: string): never {
    const status = error.statusCode || error.response?.status || error.response?.data?.error?.status || 500;
    const apiError = error.response?.data?.error;
    const message = apiError?.message || error.message || 'Request failed';
    const isRateLimit = status === 429 || message.includes('Quota exceeded') || message.includes('rate limit');

    if (isRateLimit) {
      const rateLimitErr: any = new Error('Google Business Profile API rate limit reached (HTTP 429). Please try again in a few minutes.');
      rateLimitErr.statusCode = 429;
      throw rateLimitErr;
    }

    console.error(`[GBP SERVICE] Failure during ${context}:`, error.response?.data || error.message);
    const err: any = new Error(`Google Business Profile API Error: Status ${status} - ${message}`);
    err.statusCode = typeof status === 'number' ? status : 500;
    throw err;
  }

  clearCache() {
    gbpStore.accountsCache.clear();
    gbpStore.locationsCache.clear();
    gbpStore.cooldownUntilMap.clear();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getAccessibleAccounts();
      return true;
    } catch (error: any) {
      console.error('[GBP HEALTHCHECK] Failed:', error.message);
      return false;
    }
  }

  async getAccessibleAccounts(): Promise<SafeAccountMetadata[]> {
    gbpStore.invocationCount++;
    const invId = gbpStore.invocationCount;

    const { client, contextId } = await this.getClientAndContext();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes.token || client.credentials.access_token;
    if (!accessToken) throw new Error('Google Business Profile not connected');

    // 1. Check Circuit-Breaker Cooldown
    const cooldownUntil = gbpStore.cooldownUntilMap.get(contextId) || 0;
    if (Date.now() < cooldownUntil) {
      const remainingSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      console.warn(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | Cooldown ACTIVE (${remainingSec}s remaining) | Google Called: NO`);
      
      // Fallback to DB cached metadata if available
      const dbCreds = await integrationsService.getSecureCredentials('google-business');
      if (dbCreds?.config?.accountsMetadata && Array.isArray(dbCreds.config.accountsMetadata)) {
        console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | Cooldown Fallback: Returning ${dbCreds.config.accountsMetadata.length} accounts from DB storage`);
        return dbCreds.config.accountsMetadata;
      }

      const err: any = new Error(`Google Business Profile API rate limit active. Please wait ${remainingSec} seconds before retrying.`);
      err.statusCode = 429;
      throw err;
    }

    // 2. Check 30-minute safe metadata cache
    const cached = gbpStore.accountsCache.get(contextId);
    if (cached && Date.now() < cached.expiresAt) {
      const remainingTTLSec = Math.ceil((cached.expiresAt - Date.now()) / 1000);
      console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | Memory Cache HIT (expires in ${remainingTTLSec}s) | Google Called: NO | Accounts Found: ${cached.accounts.length}`);
      return cached.accounts;
    }

    // 3. Check DB storage cache
    const dbCreds = await integrationsService.getSecureCredentials('google-business');
    if (dbCreds?.config?.accountsMetadata && Array.isArray(dbCreds.config.accountsMetadata) && dbCreds.config.accountsMetadataUpdatedMs && (Date.now() - dbCreds.config.accountsMetadataUpdatedMs < 30 * 60 * 1000)) {
      console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | DB Storage Cache HIT | Google Called: NO | Accounts Found: ${dbCreds.config.accountsMetadata.length}`);
      gbpStore.accountsCache.set(contextId, {
        accounts: dbCreds.config.accountsMetadata,
        expiresAt: Date.now() + (30 * 60 * 1000)
      });
      return dbCreds.config.accountsMetadata;
    }

    // 4. Single-Flight Request Deduplication
    if (gbpStore.pendingAccountsPromises.has(contextId)) {
      console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | In-Flight DEDUPLICATED | Google Called: NO (Reusing active request)`);
      return gbpStore.pendingAccountsPromises.get(contextId)!;
    }

    // 5. Initiate Google API Call
    const fetchPromise = (async () => {
      console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | Cache MISS | Calling Google API: GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts`);
      
      try {
        const url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts`;
        const response = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const accounts: SafeAccountMetadata[] = (response.data.accounts || []).map((acc: any) => ({
          accountId: acc.name, // e.g. accounts/12345
          accountName: acc.accountName,
          type: acc.type
        }));

        // Store safe metadata in memory cache (30 min TTL)
        gbpStore.accountsCache.set(contextId, {
          accounts,
          expiresAt: Date.now() + (30 * 60 * 1000)
        });

        // Persist safe accounts metadata to DB config
        try {
          await integrationsService.saveCredentials(
            'google-business',
            null,
            null,
            { accountsMetadata: accounts, accountsMetadataUpdatedMs: Date.now() }
          );
        } catch (dbErr: any) {
          console.error('[GBP SERVICE] Failed to save accounts metadata to DB:', dbErr.message);
        }

        // Clear any previous cooldown
        gbpStore.cooldownUntilMap.delete(contextId);

        console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | Google Call SUCCESS | Status: 200 | Accounts Returned: ${accounts.length}`);
        return accounts;
      } catch (error: any) {
        const status = error.response?.status || error.response?.data?.error?.code || error.response?.data?.error?.status;
        const apiMsg = error.response?.data?.error?.message || error.message || '';
        const isRateLimit = status === 429 || status === 'RESOURCE_EXHAUSTED' || apiMsg.includes('Quota exceeded') || apiMsg.includes('rate limit');

        if (isRateLimit) {
          let cooldownMs = 120 * 1000; // default 2 minutes cooldown
          const retryAfterHeader = error.response?.headers?.['retry-after'];
          if (retryAfterHeader) {
            const parsedSeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsedSeconds)) {
              cooldownMs = parsedSeconds * 1000;
            } else {
              const parsedDate = Date.parse(retryAfterHeader);
              if (!isNaN(parsedDate) && parsedDate > Date.now()) {
                cooldownMs = parsedDate - Date.now();
              }
            }
          }

          const newCooldownUntil = Date.now() + cooldownMs;
          gbpStore.cooldownUntilMap.set(contextId, newCooldownUntil);

          console.error(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | Google Call FAILED: HTTP 429 Quota Exceeded | Circuit-Breaker Cooldown SET for ${Math.ceil(cooldownMs / 1000)}s`);

          // Fallback to DB cached metadata if available
          const existingCreds = await integrationsService.getSecureCredentials('google-business');
          if (existingCreds?.config?.accountsMetadata && Array.isArray(existingCreds.config.accountsMetadata) && existingCreds.config.accountsMetadata.length > 0) {
            console.warn(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | 429 Fallback: Returning ${existingCreds.config.accountsMetadata.length} real accounts from DB storage`);
            return existingCreds.config.accountsMetadata;
          }

          const rateLimitErr: any = new Error(`Google Business Profile API rate limit reached (HTTP 429). Cooldown active for ${Math.ceil(cooldownMs / 1000)} seconds.`);
          rateLimitErr.statusCode = 429;
          throw rateLimitErr;
        }

        console.error(`[GBP DIAGNOSTIC] #Inv:${invId} | Ctx:${contextId} | Google Call FAILED | Status: ${status} | Error: ${apiMsg}`);
        const err: any = new Error(`Google Business Profile API Error: Status ${status || 500} - ${apiMsg}`);
        err.statusCode = typeof status === 'number' ? status : 500;
        throw err;
      }
    })();

    gbpStore.pendingAccountsPromises.set(contextId, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      gbpStore.pendingAccountsPromises.delete(contextId);
    }
  }

  async getAccessibleLocations(accountId: string): Promise<SafeLocationMetadata[]> {
    gbpStore.invocationCount++;
    const invId = gbpStore.invocationCount;

    const { client, contextId } = await this.getClientAndContext();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes.token || client.credentials.access_token;
    if (!accessToken) throw new Error('Google Business Profile not connected');

    const locationKey = `${contextId}:${accountId}`;

    // 1. Check Circuit-Breaker Cooldown
    const cooldownUntil = gbpStore.cooldownUntilMap.get(contextId) || 0;
    if (Date.now() < cooldownUntil) {
      const remainingSec = Math.ceil((cooldownUntil - Date.now()) / 1000);
      console.warn(`[GBP DIAGNOSTIC] #Inv:${invId} | LocKey:${locationKey} | Cooldown ACTIVE (${remainingSec}s remaining) | Google Called: NO | Action: Return HTTP 429`);
      const err: any = new Error(`Google Business Profile API rate limit active. Please wait ${remainingSec} seconds before retrying.`);
      err.statusCode = 429;
      throw err;
    }

    // 2. Check 10-minute safe metadata cache
    const cached = gbpStore.locationsCache.get(locationKey);
    if (cached && Date.now() < cached.expiresAt) {
      const remainingTTLSec = Math.ceil((cached.expiresAt - Date.now()) / 1000);
      console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | LocKey:${locationKey} | Cache HIT (expires in ${remainingTTLSec}s) | Google Called: NO | Locations Found: ${cached.locations.length}`);
      return cached.locations;
    }

    // 3. Single-Flight Request Deduplication
    if (gbpStore.pendingLocationsPromises.has(locationKey)) {
      console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | LocKey:${locationKey} | In-Flight DEDUPLICATED | Google Called: NO (Reusing active request)`);
      return gbpStore.pendingLocationsPromises.get(locationKey)!;
    }

    // 4. Initiate Google API Call
    const fetchPromise = (async () => {
      console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | LocKey:${locationKey} | Cache MISS | Calling Google API: GET https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations`);
      
      try {
        const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,metadata`;
        const response = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const locations: SafeLocationMetadata[] = (response.data.locations || []).map((loc: any) => {
          const addressParts = [];
          if (loc.storefrontAddress) {
            if (loc.storefrontAddress.addressLines) addressParts.push(...loc.storefrontAddress.addressLines);
            if (loc.storefrontAddress.locality) addressParts.push(loc.storefrontAddress.locality);
            if (loc.storefrontAddress.administrativeArea) addressParts.push(loc.storefrontAddress.administrativeArea);
            if (loc.storefrontAddress.postalCode) addressParts.push(loc.storefrontAddress.postalCode);
          }
          const address = addressParts.join(', ') || null;

          const phone = loc.phoneNumbers?.primaryPhone || null;
          const website = loc.websiteUri || null;
          const isVerified = loc.metadata?.isVerified || false;

          return {
            googleAccountId: accountId,
            businessAccountId: accountId.replace('accounts/', ''),
            googleLocationId: loc.name,
            name: loc.title,
            address,
            phone,
            website,
            isVerified,
          };
        });

        // Store safe metadata in cache (10 min TTL)
        gbpStore.locationsCache.set(locationKey, {
          locations,
          expiresAt: Date.now() + (10 * 60 * 1000)
        });

        // Clear any previous cooldown
        gbpStore.cooldownUntilMap.delete(contextId);

        console.log(`[GBP DIAGNOSTIC] #Inv:${invId} | LocKey:${locationKey} | Google Call SUCCESS | Status: 200 | Locations Returned: ${locations.length}`);
        return locations;
      } catch (error: any) {
        const status = error.response?.status || error.response?.data?.error?.code || error.response?.data?.error?.status;
        const apiMsg = error.response?.data?.error?.message || error.message || '';
        const isRateLimit = status === 429 || status === 'RESOURCE_EXHAUSTED' || apiMsg.includes('Quota exceeded') || apiMsg.includes('rate limit');

        if (isRateLimit) {
          let cooldownMs = 120 * 1000;
          const retryAfterHeader = error.response?.headers?.['retry-after'];
          if (retryAfterHeader) {
            const parsedSeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsedSeconds)) {
              cooldownMs = parsedSeconds * 1000;
            } else {
              const parsedDate = Date.parse(retryAfterHeader);
              if (!isNaN(parsedDate) && parsedDate > Date.now()) {
                cooldownMs = parsedDate - Date.now();
              }
            }
          }

          const newCooldownUntil = Date.now() + cooldownMs;
          gbpStore.cooldownUntilMap.set(contextId, newCooldownUntil);

          console.error(`[GBP DIAGNOSTIC] #Inv:${invId} | LocKey:${locationKey} | Google Call FAILED: HTTP 429 Quota Exceeded | Circuit-Breaker Cooldown SET for ${Math.ceil(cooldownMs / 1000)}s`);

          const rateLimitErr: any = new Error(`Google Business Profile API rate limit reached (HTTP 429). Cooldown active for ${Math.ceil(cooldownMs / 1000)} seconds.`);
          rateLimitErr.statusCode = 429;
          throw rateLimitErr;
        }

        console.error(`[GBP DIAGNOSTIC] #Inv:${invId} | LocKey:${locationKey} | Google Call FAILED | Status: ${status} | Error: ${apiMsg}`);
        const err: any = new Error(`Google Business Profile API Error: Status ${status || 500} - ${apiMsg}`);
        err.statusCode = typeof status === 'number' ? status : 500;
        throw err;
      }
    })();

    gbpStore.pendingLocationsPromises.set(locationKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      gbpStore.pendingLocationsPromises.delete(locationKey);
    }
  }

  async syncReviews() {
    const client = await this.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes.token || client.credentials.access_token;
    if (!accessToken) throw new Error('Google Business Profile not connected');

    // Get all clinics mapped to a Google Location
    const clinics = await prisma.clinic.findMany({
      where: { googleLocationId: { not: null } }
    });

    if (clinics.length === 0) {
      console.log('[GBP SYNC] No mapped clinics found.');
      return { success: true, count: 0, message: 'No mapped clinics found.' };
    }

    let syncedCount = 0;

    for (const clinic of clinics) {
      const googleLocationId = clinic.googleLocationId!;
      // Get reviews for this location
      const url = `https://mybusiness.googleapis.com/v4/${googleLocationId}/reviews`;

      try {
        console.log(`[GBP SYNC] Fetching reviews for mapped clinic: ${clinic.name} (${googleLocationId})`);
        const res = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const reviews = res.data.reviews || [];
        console.log(`[GBP SYNC] Retrieved ${reviews.length} reviews for ${clinic.name}`);

        for (const rev of reviews) {
          const externalReviewId = rev.reviewId;
          const ratingNum = rev.starRating === 'FIVE' ? 5.0 : rev.starRating === 'FOUR' ? 4.0 : rev.starRating === 'THREE' ? 3.0 : rev.starRating === 'TWO' ? 2.0 : 1.0;
          const authorName = rev.reviewer?.displayName || 'Google User';
          
          const date = new Date(rev.createTime);
          const reviewUpdatedAt = rev.updateTime ? new Date(rev.updateTime) : date;
          const comment = rev.comment || '';
          
          const replyText = rev.reviewReply?.comment || null;
          const repliedAt = rev.reviewReply?.updateTime ? new Date(rev.reviewReply.updateTime) : null;
          
          let responseTime: number | null = null;
          if (repliedAt) {
            responseTime = Math.max(0, Math.floor((repliedAt.getTime() - date.getTime()) / 1000));
          }

          const reviewUrl = rev.reviewReply?.reviewUrl || `https://search.google.com/local/reviews?placeid=&q=${encodeURIComponent(clinic.name)}`;

          const data: any = {
            platform: 'Google',
            rating: ratingNum,
            comment: comment,
            authorName: authorName,
            date: date,
            externalReviewId: externalReviewId,
            googleReviewId: externalReviewId,
            googleLocationId: googleLocationId,
            clinicId: clinic.id,
            reply: replyText,
            repliedAt: repliedAt,
            reviewUrl: reviewUrl,
            responseTime: responseTime,
            reviewUpdatedAt: reviewUpdatedAt,
          };

          const existing = await prisma.review.findUnique({
            where: {
              platform_externalReviewId: {
                platform: 'Google',
                externalReviewId: externalReviewId
              }
            }
          });

          if (existing) {
            await prisma.review.update({
              where: { id: existing.id },
              data
            });
          } else {
            await prisma.review.create({
              data
            });
          }
          syncedCount++;
        }
      } catch (err: any) {
        const endpoint = err.config?.url || 'unknown endpoint';
        const status = err.response?.status || err.response?.data?.error?.status || 'unknown status';
        const apiError = err.response?.data?.error;
        const message = apiError?.message || err.message || 'Request failed';
        const errorString = `Google Business Profile API Error: Status ${status} on endpoint ${endpoint} - ${message}`;

        await prisma.integrationCredential.updateMany({
          where: { platformName: 'google-business' },
          data: {
            lastSyncAt: new Date(),
            lastError: errorString
          }
        });

        this.handleApiError(err, `syncReviews (Location: ${googleLocationId})`);
      }
    }

    // Update integration credential sync status
    await prisma.integrationCredential.updateMany({
      where: { platformName: 'google-business' },
      data: {
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastError: null,
        isActive: true
      }
    });

    return { success: true, count: syncedCount };
  }

  async replyToReview(reviewId: string, replyText: string) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId }
    });

    if (!review || !review.googleLocationId || !review.googleReviewId) {
      throw new Error('Review not found or does not have Google Business Profile identifier metadata');
    }

    const client = await this.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes.token || client.credentials.access_token;
    if (!accessToken) throw new Error('Google Business Profile not connected');

    const url = `https://mybusiness.googleapis.com/v4/${review.googleLocationId}/reviews/${review.googleReviewId}/reply`;

    try {
      const response = await axios.put(url, {
        comment: replyText
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const repliedAt = new Date();
      let responseTime: number | null = null;
      if (review.date) {
        responseTime = Math.max(0, Math.floor((repliedAt.getTime() - new Date(review.date).getTime()) / 1000));
      }

      await prisma.review.update({
        where: { id: reviewId },
        data: {
          reply: replyText,
          repliedAt,
          responseTime
        }
      });

      return { success: true, reply: replyText, repliedAt };
    } catch (error: any) {
      this.handleApiError(error, 'replyToReview');
    }
  }

  async fetchAndSaveSingleReview(reviewName: string) {
    // reviewName format: accounts/{accountId}/locations/{locationId}/reviews/{reviewId}
    const parts = reviewName.split('/');
    if (parts.length < 6) throw new Error('Invalid review resource name format');

    const googleLocationId = parts[0] + '/' + parts[1] + '/' + parts[2] + '/' + parts[3];

    // Find mapped clinic
    const clinic = await prisma.clinic.findFirst({
      where: { googleLocationId }
    });

    if (!clinic) {
      throw new Error(`No mapped clinic found for Google location ID: ${googleLocationId}`);
    }

    const client = await this.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes.token || client.credentials.access_token;
    if (!accessToken) throw new Error('Google Business Profile not connected');

    const url = `https://mybusiness.googleapis.com/v4/${reviewName}`;
    let response;
    try {
      response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
    } catch (error: any) {
      this.handleApiError(error, 'fetchAndSaveSingleReview');
    }

    const rev = response.data;
    const externalReviewId = rev.reviewId;
    const ratingNum = rev.starRating === 'FIVE' ? 5.0 : rev.starRating === 'FOUR' ? 4.0 : rev.starRating === 'THREE' ? 3.0 : rev.starRating === 'TWO' ? 2.0 : 1.0;
    const authorName = rev.reviewer?.displayName || 'Google User';
    
    const date = new Date(rev.createTime);
    const reviewUpdatedAt = rev.updateTime ? new Date(rev.updateTime) : date;
    const comment = rev.comment || '';
    
    const replyText = rev.reviewReply?.comment || null;
    const repliedAt = rev.reviewReply?.updateTime ? new Date(rev.reviewReply.updateTime) : null;
    
    let responseTime: number | null = null;
    if (repliedAt) {
      responseTime = Math.max(0, Math.floor((repliedAt.getTime() - date.getTime()) / 1000));
    }

    const reviewUrl = rev.reviewReply?.reviewUrl || `https://search.google.com/local/reviews?placeid=&q=${encodeURIComponent(clinic.name)}`;

    const data: any = {
      platform: 'Google',
      rating: ratingNum,
      comment: comment,
      authorName: authorName,
      date: date,
      externalReviewId: externalReviewId,
      googleReviewId: externalReviewId,
      googleLocationId: googleLocationId,
      clinicId: clinic.id,
      reply: replyText,
      repliedAt: repliedAt,
      reviewUrl: reviewUrl,
      responseTime: responseTime,
      reviewUpdatedAt: reviewUpdatedAt,
    };

    const existing = await prisma.review.findUnique({
      where: {
        platform_externalReviewId: {
          platform: 'Google',
          externalReviewId: externalReviewId
        }
      }
    });

    let savedReview;
    if (existing) {
      savedReview = await prisma.review.update({
        where: { id: existing.id },
        data,
        include: { clinic: true }
      });
    } else {
      savedReview = await prisma.review.create({
        data,
        include: { clinic: true }
      });
    }

    // Trigger staff notifications asynchronously
    try {
      const { notificationService } = require('./notification.service');
      await notificationService.sendNewReviewAlert(savedReview, clinic.name);
    } catch (notifErr: any) {
      console.error('[GBP WEBHOOK] Failed to dispatch staff notifications:', notifErr.message);
    }

    return savedReview;
  }
}

export const googleBusinessService = new GoogleBusinessService();
