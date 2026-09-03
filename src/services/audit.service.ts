import prisma from '../plugins/db';
import { FastifyRequest } from 'fastify';
import { AuthenticatedUser } from '../middlewares/auth.middleware';

/**
 * Standard Security Audit Event Types
 */
export const SecurityEvents = {
  // Authentication & Sessions
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ALL_SESSIONS_REVOKED: 'ALL_SESSIONS_REVOKED',
  TOKEN_ROTATED: 'TOKEN_ROTATED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',

  // Multi-Factor Authentication (MFA)
  MFA_ENROLLMENT_STARTED: 'MFA_ENROLLMENT_STARTED',
  MFA_ENROLLMENT_VERIFIED: 'MFA_ENROLLMENT_VERIFIED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_VERIFICATION_SUCCESS: 'MFA_VERIFICATION_SUCCESS',
  MFA_VERIFICATION_FAILED: 'MFA_VERIFICATION_FAILED',
  MFA_RECOVERY_CODE_USED: 'MFA_RECOVERY_CODE_USED',
  MFA_RECOVERY_CODES_REGENERATED: 'MFA_RECOVERY_CODES_REGENERATED',
  MFA_DISABLED: 'MFA_DISABLED',
  MFA_CHALLENGE_EXPIRED: 'MFA_CHALLENGE_EXPIRED',
  MFA_CHALLENGE_REPLAY_BLOCKED: 'MFA_CHALLENGE_REPLAY_BLOCKED',

  // Authorization
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',

  // User Management
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DISABLED: 'USER_DISABLED',
  USER_ENABLED: 'USER_ENABLED',
  USER_DELETED: 'USER_DELETED',

  // Patient / PHI Resource Access
  PATIENT_VIEW: 'PATIENT_VIEW',
  PATIENT_CREATE: 'PATIENT_CREATE',
  PATIENT_UPDATE: 'PATIENT_UPDATE',
  PATIENT_DELETE: 'PATIENT_DELETE',

  // Documents & Exports
  DOCUMENT_VIEW: 'DOCUMENT_VIEW',
  DOCUMENT_UPLOAD: 'DOCUMENT_UPLOAD',
  DOCUMENT_DOWNLOAD: 'DOCUMENT_DOWNLOAD',
  DOCUMENT_DELETE: 'DOCUMENT_DELETE',
  DATA_EXPORT: 'DATA_EXPORT',

  // Administration & Config
  ADMIN_SECURITY_ACTION: 'ADMIN_SECURITY_ACTION',
  AUDIT_LOG_VIEW: 'AUDIT_LOG_VIEW',

  // Backup, Disaster Recovery & System Diagnostics
  BACKUP_CREATED: 'BACKUP_CREATED',
  BACKUP_VERIFIED: 'BACKUP_VERIFIED',
  BACKUP_RESTORE_STARTED: 'BACKUP_RESTORE_STARTED',
  BACKUP_RESTORE_COMPLETED: 'BACKUP_RESTORE_COMPLETED',
  BACKUP_RESTORE_FAILED: 'BACKUP_RESTORE_FAILED',
  DISASTER_RECOVERY_TESTED: 'DISASTER_RECOVERY_TESTED',
  SYSTEM_HEALTH_DIAGNOSTIC: 'SYSTEM_HEALTH_DIAGNOSTIC'
} as const;

export type SecurityEventType = typeof SecurityEvents[keyof typeof SecurityEvents] | string;

export interface LogSecurityEventInput {
  user?: AuthenticatedUser | { id?: string; email?: string; roleName?: string } | null;
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: SecurityEventType;
  resourceType?: string | null;
  resourceId?: string | null;
  resource?: string | null;
  request?: FastifyRequest | null;
  requestMethod?: string | null;
  route?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
  failureReason?: string | null;
}

export interface AuditQueryFilters {
  startDate?: string;
  endDate?: string;
  userId?: string;
  userRole?: string;
  action?: string;
  resourceType?: string;
  success?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export class AuditService {
  extractRequestMeta(request?: FastifyRequest | null) {
    return AuditService.extractRequestMeta(request);
  }

  /**
   * Helper to safely extract IP and User-Agent from Fastify request
   */
  static extractRequestMeta(request?: FastifyRequest | null) {
    if (!request) return {};
    const ipAddress = (request.headers['x-forwarded-for'] as string) || request.ip || '127.0.0.1';
    const userAgent = (request.headers['user-agent'] as string) || 'Unknown';
    const requestMethod = request.method;
    const route = request.url?.split('?')[0] || request.url;
    return {
      ipAddress: typeof ipAddress === 'string' ? ipAddress.split(',')[0].trim() : '127.0.0.1',
      userAgent: userAgent.substring(0, 500),
      requestMethod,
      route
    };
  }

  /**
   * Records a centralized, tamper-resistant security audit log entry.
   * Never stores sensitive tokens, passwords, or raw PHI bodies.
   */
  async log(input: LogSecurityEventInput) {
    try {
      const meta = input.request ? AuditService.extractRequestMeta(input.request) : {};

      const userId = input.user?.id || input.userId || null;
      const userEmail = input.user?.email || input.userEmail || null;
      const userRole = (input.user as any)?.roleName || input.userRole || null;

      const resourceStr = input.resource || (input.resourceType && input.resourceId ? `${input.resourceType}:${input.resourceId}` : input.resourceType || null);

      return await prisma.activityLog.create({
        data: {
          userId,
          userEmail,
          userRole,
          action: input.action,
          resourceType: input.resourceType || null,
          resourceId: input.resourceId || null,
          resource: resourceStr,
          requestMethod: input.requestMethod || meta.requestMethod || null,
          route: input.route || meta.route || null,
          ipAddress: input.ipAddress || meta.ipAddress || null,
          userAgent: input.userAgent || meta.userAgent || null,
          success: input.success !== undefined ? input.success : true,
          failureReason: input.failureReason ? input.failureReason.substring(0, 500) : null
        }
      });
    } catch (err: any) {
      console.error('[AUDIT SERVICE ERROR] Failed to write security audit log:', err.message);
      // In critical healthcare architectures, audit failures must be logged to stderr/monitoring
      return null;
    }
  }

  /**
   * Retrieves audit logs with strict filtering, search, and pagination.
   * Accessible only by authorized administrators.
   */
  async getLogs(filters: AuditQueryFilters = {}) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.userRole) where.userRole = filters.userRole;
    if (filters.action) where.action = filters.action;
    if (filters.resourceType) where.resourceType = filters.resourceType;
    if (filters.success !== undefined) where.success = filters.success;

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = new Date(filters.startDate);
      if (filters.endDate) where.timestamp.lte = new Date(filters.endDate);
    }

    if (filters.search) {
      where.OR = [
        { action: { contains: filters.search } },
        { userEmail: { contains: filters.search } },
        { resource: { contains: filters.search } },
        { resourceType: { contains: filters.search } },
        { failureReason: { contains: filters.search } }
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              roleName: true
            }
          }
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit
      })
    ]);

    return {
      logs,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
}

export const auditService = new AuditService();
