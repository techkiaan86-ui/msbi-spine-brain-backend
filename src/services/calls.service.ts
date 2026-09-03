import prisma from '../plugins/db';
import { CreateCallLogInput } from '../validators/calls.schema';

export class CallsService {
  async createCall(data: CreateCallLogInput) {
    const callLog = await prisma.callLog.create({
      data: {
        caller: data.caller,
        phone: data.phone,
        duration: data.duration,
        campaign: data.campaign,
        status: data.status || 'Missed',
        location: data.location,
        audioUrl: data.audioUrl,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshot = await prisma.analyticsSnapshot.findFirst({
      where: { date: today }
    });

    if (snapshot) {
      await prisma.analyticsSnapshot.update({
        where: { id: snapshot.id },
        data: {
          calls: { increment: 1 }
        }
      });
    } else {
      await prisma.analyticsSnapshot.create({
        data: {
          date: today,
          calls: 1,
        }
      });
    }

    return callLog;
  }

  async getCalls() {
    return prisma.callLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
  }
}

export const callsService = new CallsService();
