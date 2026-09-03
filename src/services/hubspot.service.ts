import axios from 'axios';
import prisma from '../plugins/db';
import { integrationsService } from './integrations.service';

export class HubSpotService {
  private async getClient() {
    const creds = await integrationsService.getSecureCredentials('hubspot');
    if (!creds || !creds.accessToken) return null;
    return axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async syncLeads() {
    const client = await this.getClient();
    if (!client) throw new Error('HubSpot is not configured or connected.');

    // In a real implementation we would handle pagination
    const response = await client.get('/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,email,phone,lifecyclestage,hs_analytics_source');
    const contacts = response.data.results || [];

    let syncedCount = 0;
    for (const contact of contacts) {
      const { id, properties, createdAt, updatedAt } = contact;
      const firstName = properties.firstname || '';
      const lastName = properties.lastname || '';
      const name = `${firstName} ${lastName}`.trim() || 'Unknown';
      const email = properties.email || null;
      const phone = properties.phone || null;
      const lifecycle = properties.lifecyclestage || 'New';
      const source = properties.hs_analytics_source || 'HubSpot Sync';

      // Use upsert to safely map leads
      await prisma.lead.upsert({
        where: {
          leadPlatform_externalLeadId: {
            leadPlatform: 'hubspot',
            externalLeadId: id
          }
        },
        update: {
          name,
          email,
          phone,
          source,
          // We DO NOT blindly overwrite CRM lead status here. We only sync safely mapped source/identity fields.
        },
        create: {
          name,
          email,
          phone,
          source,
          status: lifecycle, // Initial mapping only
          leadPlatform: 'hubspot',
          externalLeadId: id
        }
      });
      syncedCount++;
    }

    // Update sync time
    await prisma.integrationCredential.update({
      where: { platformName: 'hubspot' },
      data: {
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastError: null
      }
    });

    return { success: true, count: syncedCount };
  }
}

export const hubspotService = new HubSpotService();
