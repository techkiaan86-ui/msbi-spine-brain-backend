import prisma from '../plugins/db';
import { UpdateOrganizationInput } from '../validators/settings.schema';

export class SettingsService {
  async getOrganization() {
    return prisma.organization.findFirst();
  }

  async updateOrganization(data: UpdateOrganizationInput) {
    const org = await prisma.organization.findFirst();
    if (!org) {
      return prisma.organization.create({
        data: {
          name: data.name || 'Default Org',
          timezone: data.timezone,
          currency: data.currency,
        },
      });
    }
    return prisma.organization.update({
      where: { id: org.id },
      data,
    });
  }

  async getClinics() {
    return prisma.clinic.findMany();
  }

  async getProviders() {
    return prisma.provider.findMany({
      include: { clinic: true }
    });
  }
}

export const settingsService = new SettingsService();
