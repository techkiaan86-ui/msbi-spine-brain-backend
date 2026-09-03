import { google } from 'googleapis';
import { randomBytes } from 'crypto';

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/business.manage'
];

export class GoogleOAuthService {
  private getClient() {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  getAuthUrl(state: string) {
    const oauth2Client = this.getClient();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: SCOPES,
      state, // Secure random state passed in from the router
    });
  }

  async getTokens(code: string) {
    const oauth2Client = this.getClient();
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  /**
   * Retrieves an authenticated client based on decrypted DB credentials.
   * Also returns whether the token was refreshed, so the caller can save the new token if needed.
   */
  async getAuthenticatedClient(accessToken: string, refreshToken?: string | null, expiryDate?: number | null) {
    const oauth2Client = this.getClient();
    
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken || undefined,
      expiry_date: expiryDate || undefined
    });

    let wasRefreshed = false;
    let newTokens = null;

    oauth2Client.on('tokens', (tokens) => {
      wasRefreshed = true;
      newTokens = tokens;
    });

    // We don't manually force refresh here unless it fails. The googleapis library handles auto-refresh
    // when a request is made, triggering the 'tokens' event. We can return the client directly.
    return {
      client: oauth2Client,
      onTokens: (callback: (tokens: any) => void) => {
        oauth2Client.on('tokens', callback);
      }
    };
  }

  generateStateToken(): string {
    return randomBytes(32).toString('hex');
  }
}

export const googleOAuthService = new GoogleOAuthService();
