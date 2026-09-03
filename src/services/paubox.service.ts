import axios from 'axios';

export interface SendPauboxEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class PauboxService {
  /**
   * Send HIPAA-compliant encrypted email via Paubox REST API v1
   */
  async sendEncryptedEmail(options: SendPauboxEmailOptions): Promise<{ success: boolean; messageId?: string; mock?: boolean }> {
    const apiKey = process.env.PAUBOX_API_KEY;
    const apiUser = process.env.PAUBOX_API_USER;
    const fromEmail = process.env.PAUBOX_FROM_EMAIL || process.env.EMAIL_FROM || 'reviews@midwestspine.net';

    if (!apiKey || !apiUser) {
      console.log(`[PAUBOX EMAIL MOCK] To: ${options.to} | Subject: "${options.subject}" | (PAUBOX_API_KEY / PAUBOX_API_USER not configured)`);
      return { success: true, mock: true };
    }

    try {
      const url = `https://api.paubox.net/v1/${apiUser}/messages`;
      
      const payload = {
        data: {
          message: {
            recipients: [options.to],
            headers: {
              subject: options.subject,
              from: fromEmail
            },
            content: {
              'text/html': options.html,
              ...(options.text ? { 'text/plain': options.text } : {})
            }
          }
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Token token=${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const messageId = response.data?.data?.sourceMessageId || response.data?.sourceMessageId || 'paubox_msg_ok';
      console.log(`[PAUBOX EMAIL SUCCESS] Sent encrypted email to ${options.to} | MsgID: ${messageId}`);
      return { success: true, messageId };
    } catch (error: any) {
      const errorMsg = error.response?.data?.errors || error.response?.data?.message || error.message;
      console.error(`[PAUBOX EMAIL ERROR] Failed to send email to ${options.to}:`, errorMsg);
      throw new Error(`Paubox Email Delivery Error: ${typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : errorMsg}`);
    }
  }
}

export const pauboxService = new PauboxService();
