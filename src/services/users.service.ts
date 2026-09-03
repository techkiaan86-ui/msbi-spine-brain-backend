import prisma from '../plugins/db';
import { CreateUserInput } from '../validators/users.schema';
import bcrypt from 'bcryptjs';

export class UsersService {
  async getAllUsers() {
    return prisma.user.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roleName: true,
        isActive: true,
        department: true,
        createdAt: true,
        phoneNumber: true,
        emailAlerts: true,
        smsAlerts: true,
        alertLocations: true,
      },
    });
  }

  async createUser(data: CreateUserInput) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password, salt);

    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        roleName: data.role,
        departmentId: data.departmentId,
      },
    });
  }

  async getRoles() {
    // In a simple setup, extract unique roles from DB or return static list
    return [
      { id: 'ADMIN', name: 'Administrator' },
      { id: 'MARKETING_MANAGER', name: 'Marketing Manager' },
      { id: 'USER', name: 'Standard User' }
    ];
  }

  async getActivityLogs() {
    return prisma.activityLog.findMany({
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { timestamp: 'desc' },
      take: 50
    });
  }

  async updateNotificationPreferences(id: string, data: { phoneNumber?: string | null; emailAlerts: boolean; smsAlerts: boolean; alertLocations?: string[] | null }) {
    return prisma.user.update({
      where: { id },
      data: {
        phoneNumber: data.phoneNumber,
        emailAlerts: data.emailAlerts,
        smsAlerts: data.smsAlerts,
        alertLocations: data.alertLocations || null
      }
    });
  }
}

export const usersService = new UsersService();
