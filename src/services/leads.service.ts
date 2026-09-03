import prisma from '../plugins/db';
import { CreateLeadInput } from '../validators/leads.schema';

export class LeadsService {
  async createLead(data: CreateLeadInput) {
    // 1. Create the lead in the database
    const lead = await prisma.lead.create({
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        condition: data.condition || null,
        source: data.source || 'Website Contact Form',
        status: 'New',
      },
    });

    // 2. Also increment the analytics snapshot for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshot = await prisma.analyticsSnapshot.findFirst({
      where: { date: today }
    });

    if (snapshot) {
      await prisma.analyticsSnapshot.update({
        where: { id: snapshot.id },
        data: {
          leads: { increment: 1 },
          formSubmissions: { increment: 1 }
        }
      });
    } else {
      await prisma.analyticsSnapshot.create({
        data: {
          date: today,
          leads: 1,
          formSubmissions: 1,
        }
      });
    }

    return lead;
  }

  async getLeads() {
    return prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

export const leadsService = new LeadsService();
