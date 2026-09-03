import axios from 'axios';
import prisma from '../plugins/db';
import { pauboxService } from './paubox.service';

export interface PatientReviewRequestParams {
  to: string;
  patientName: string;
  clinicName: string;
  reviewLink: string;
  method?: 'SMS' | 'EMAIL';
}

export class NotificationService {
  async sendPatientReviewRequest(params: PatientReviewRequestParams): Promise<{ success: boolean; method: string }> {
    const { to, patientName, clinicName, reviewLink, method = 'EMAIL' } = params;

    const subject = `How was your visit at ${clinicName}?`;
    const textBody = `Hello ${patientName},\n\nThank you for visiting ${clinicName}! We value your feedback. Please take 1 minute to share your experience with us:\n\n${reviewLink}\n\n- Midwest Spine & Brain Institute`;

    const htmlBody = `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
        <div style="text-align: center; padding-bottom: 16px; border-bottom: 2px solid #045CB4;">
          <h2 style="color: #045CB4; margin: 0; font-size: 22px;">Midwest Spine & Brain Institute</h2>
          <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Patient Experience & Healthcare Feedback</p>
        </div>
        <div style="padding: 24px 0;">
          <p style="font-size: 15px; color: #1e293b;">Dear <strong>${patientName}</strong>,</p>
          <p style="font-size: 14px; color: #334155; line-height: 1.6;">
            Thank you for choosing <strong>${clinicName}</strong> for your healthcare consultation. We strive to deliver the highest standard of specialized spine and brain care.
          </p>
          <p style="font-size: 14px; color: #334155;">
            We would greatly appreciate it if you could take 30 seconds to share your review on Google:
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${reviewLink}" target="_blank" style="background-color: #045CB4; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(4, 92, 180, 0.2);">
              ⭐ Leave a Google Review
            </a>
          </div>
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
            Direct Link: <a href="${reviewLink}" style="color: #045CB4;">${reviewLink}</a>
          </p>
        </div>
        <div style="border-top: 1px solid #e2e8f0; pt: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
          <p>Midwest Spine & Brain Institute • Specialized Orthopedic & Neurosurgery Care</p>
        </div>
      </div>
    `;

    if (method === 'SMS' || (to.match(/^[\d\+\-\(\)\s]+$/) && !to.includes('@'))) {
      await this.sendSms(to, textBody);
      return { success: true, method: 'SMS' };
    } else {
      // Send Email via Paubox API (or SendGrid fallback if Paubox is unconfigured)
      if (process.env.PAUBOX_API_KEY && process.env.PAUBOX_API_USER) {
        await pauboxService.sendEncryptedEmail({
          to,
          subject,
          html: htmlBody,
          text: textBody
        });
      } else {
        await this.sendEmail(to, subject, textBody);
      }
      return { success: true, method: 'EMAIL' };
    }
  }

  async sendNewReviewAlert(review: any, clinicName: string) {
    // 1. Fetch all active users who have alerts enabled
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { emailAlerts: true },
          { smsAlerts: true }
        ],
        isActive: true
      }
    });

    const crmUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reputation/reviews`;
    const ratingStars = '★'.repeat(Math.round(review.rating)) + '☆'.repeat(5 - Math.round(review.rating));

    const subject = `New ${review.rating}-Star Google Review for ${clinicName}`;
    const bodyText = `
New Google Review feedback received!

Location: ${clinicName}
Reviewer: ${review.authorName || 'Anonymous'}
Rating: ${ratingStars} (${review.rating} Stars)
Review: "${review.comment || '(No comment)'}"
Status: Unanswered

View and reply to this review in MSBI CRM:
${crmUrl}
    `;

    for (const user of users) {
      // Parse location preferences
      let alertLocationsArray: string[] = [];
      if (user.alertLocations) {
        try {
          alertLocationsArray = typeof user.alertLocations === 'string'
            ? JSON.parse(user.alertLocations)
            : (Array.isArray(user.alertLocations) ? (user.alertLocations as string[]) : []);
        } catch (e) {
          alertLocationsArray = [];
        }
      }

      // If user has alert locations preference set, and this review location is not in it, filter it out!
      if (alertLocationsArray.length > 0 && review.googleLocationId && !alertLocationsArray.includes(review.googleLocationId)) {
        console.log(`[ALERT ROUTING] Skipping alert for user ${user.email} (location ${review.googleLocationId} not in routing preference).`);
        continue;
      }

      // Send Email alert
      if (user.emailAlerts && user.email) {
        await this.sendEmail(user.email, subject, bodyText);
      }

      // Send SMS alert
      if (user.smsAlerts && user.phoneNumber) {
        await this.sendSms(user.phoneNumber, bodyText);
      }
    }
  }

  private async sendEmail(to: string, subject: string, text: string) {
    if (process.env.SENDGRID_API_KEY) {
      try {
        await axios.post(
          'https://api.sendgrid.com/v3/mail/send',
          {
            personalizations: [{ to: [{ email: to }] }],
            from: { email: process.env.EMAIL_FROM || 'alerts@msbi-spine-brain.com', name: 'MSBI CRM Alerts' },
            subject: subject,
            content: [{ type: 'text/plain', value: text }]
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`[EMAIL ALERT] Sent successfully to ${to}`);
      } catch (err: any) {
        console.error(`[EMAIL ALERT] Failed to send to ${to} via SendGrid:`, err.response?.data || err.message);
      }
    } else {
      console.log(`[EMAIL ALERT MOCK] To: ${to} | Subject: ${subject} | Length: ${text?.length || 0} chars`);
    }
  }

  private async sendSms(to: string, text: string) {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
      try {
        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
          new URLSearchParams({
            To: to,
            From: process.env.TWILIO_PHONE_NUMBER,
            Body: text
          }).toString(),
          {
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        console.log(`[SMS ALERT] Sent successfully to ${to}`);
      } catch (err: any) {
        console.error(`[SMS ALERT] Failed to send to ${to} via Twilio:`, err.response?.data || err.message);
      }
    } else {
      console.log(`[SMS ALERT MOCK] To: ${to} | Length: ${text?.length || 0} chars`);
    }
  }
}

export const notificationService = new NotificationService();

