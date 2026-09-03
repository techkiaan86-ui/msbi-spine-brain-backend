import prisma from '../plugins/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { LoginInput, ChangePasswordInput } from '../validators/auth.schema';
import { getJwtSecret, getJwtExpiresIn } from '../middlewares/auth.middleware';
import { auditService, SecurityEvents } from './audit.service';

export interface RequestSessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export class AuthService {
  /**
   * Hashes a refresh token using SHA-256 for secure server-side storage.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Generates a cryptographically random refresh token.
   */
  generateRefreshToken(): string {
    return crypto.randomBytes(40).toString('hex');
  }

  /**
   * Calculates session expiration date (default: 7 days).
   */
  getSessionExpiresAt(): Date {
    const days = parseInt(process.env.SESSION_EXPIRES_IN_DAYS || '7', 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (isNaN(days) ? 7 : days));
    return expiresAt;
  }

  /**
   * Authenticates user credentials, creates a server session, and issues tokens.
   */
  async login(data: LoginInput, meta?: RequestSessionMeta) {
    const email = data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: true,
        department: true,
        mfa: true
      }
    });

    // Generic error message to prevent user enumeration
    if (!user) {
      throw new Error('Invalid email or password');
    }

    if (!user.isActive) {
      throw new Error('Invalid email or password');
    }

    const isValidPassword = await bcrypt.compare(data.password, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // If Multi-Factor Authentication is enabled, issue a 5-minute single-use MFA challenge
    if (user.mfa && user.mfa.enabled) {
      const { mfaService } = await import('./mfa.service');
      const mfaChallenge = await mfaService.createLoginChallenge(user.id, meta);

      return {
        mfaRequired: true,
        mfaChallenge,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.roleName
        }
      };
    }

    // Generate refresh token and store secure SHA-256 hash in database
    const rawRefreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashToken(rawRefreshToken);
    const sessionExpiresAt = this.getSessionExpiresAt();

    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        ipAddress: meta?.ipAddress || null,
        userAgent: meta?.userAgent ? meta.userAgent.slice(0, 500) : null,
        expiresAt: sessionExpiresAt,
        lastUsedAt: new Date()
      }
    });

    const secret = getJwtSecret();
    const expiresIn = getJwtExpiresIn();

    // Access token includes userId and sessionId for server-side revocation tracking
    const accessToken = jwt.sign(
      {
        userId: user.id,
        sessionId: session.id,
        email: user.email,
        role: user.roleName
      },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: expiresIn as any
      }
    );

    return {
      token: accessToken,
      refreshToken: rawRefreshToken,
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.roleName,
        departmentId: user.departmentId,
        department: user.department ? {
          id: user.department.id,
          name: user.department.name
        } : null
      }
    };
  }

  /**
   * Refreshes an access token and rotates the refresh token.
   * Includes reuse detection: if a revoked refresh token is presented, all sessions for that user are terminated.
   */
  async refresh(rawRefreshToken: string, meta?: RequestSessionMeta) {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      const err: any = new Error('Refresh token is required');
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = this.hashToken(rawRefreshToken);

    const session = await prisma.userSession.findFirst({
      where: { refreshTokenHash: tokenHash },
      include: {
        user: {
          include: {
            role: true,
            department: true
          }
        }
      }
    });

    if (!session) {
      const err: any = new Error('Invalid refresh token');
      err.statusCode = 401;
      throw err;
    }

    // REUSE DETECTION: If an already-revoked session token is reused, revoke ALL sessions for this user
    if (session.revokedAt) {
      await this.revokeAllUserSessions(session.userId, 'Security alert: Revoked refresh token reuse detected');
      
      await auditService.log({
        action: SecurityEvents.TOKEN_REUSE_DETECTED,
        userId: session.userId,
        userEmail: session.user?.email,
        userRole: session.user?.roleName,
        resourceType: 'UserSession',
        resourceId: session.id,
        success: false,
        failureReason: 'Attempted reuse of revoked refresh token. All active user sessions revoked.'
      });

      const err: any = new Error('Invalid refresh token. Session has been terminated for security.');
      err.statusCode = 401;
      throw err;
    }

    // Check expiration
    if (session.expiresAt < new Date()) {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'Session expired' }
      });

      const err: any = new Error('Refresh token has expired. Please log in again.');
      err.statusCode = 401;
      throw err;
    }

    // Check if user account is disabled
    if (!session.user || !session.user.isActive) {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'User account deactivated' }
      });

      const err: any = new Error('User account is deactivated');
      err.statusCode = 403;
      throw err;
    }

    // ROTATION: Generate new refresh token and update database record
    const newRawRefreshToken = this.generateRefreshToken();
    const newRefreshTokenHash = this.hashToken(newRawRefreshToken);
    const newExpiresAt = this.getSessionExpiresAt();

    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: newExpiresAt,
        lastUsedAt: new Date(),
        ipAddress: meta?.ipAddress || session.ipAddress,
        userAgent: meta?.userAgent ? meta.userAgent.slice(0, 500) : session.userAgent
      }
    });

    const secret = getJwtSecret();
    const expiresIn = getJwtExpiresIn();

    const newAccessToken = jwt.sign(
      {
        userId: session.user.id,
        sessionId: session.id,
        email: session.user.email,
        role: session.user.roleName
      },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: expiresIn as any
      }
    );

    return {
      token: newAccessToken,
      refreshToken: newRawRefreshToken,
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        role: session.user.roleName,
        departmentId: session.user.departmentId,
        department: session.user.department ? {
          id: session.user.department.id,
          name: session.user.department.name
        } : null
      }
    };
  }

  /**
   * Revokes the current session on logout.
   */
  async logout(sessionId?: string | null, userId?: string | null) {
    if (sessionId) {
      await prisma.userSession.updateMany({
        where: {
          id: sessionId,
          revokedAt: null
        },
        data: {
          revokedAt: new Date(),
          revokedReason: 'User logout'
        }
      });
    }
  }

  /**
   * Changes user password, verifies current password, hashes new password with bcrypt,
   * and invalidates all previous sessions.
   */
  async changePassword(userId: string, data: ChangePasswordInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      const err: any = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    const isCurrentValid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      const err: any = new Error('Current password is incorrect');
      err.statusCode = 400;
      throw err;
    }

    // Hash new password with cost factor 10
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(data.newPassword, salt);

    // Update password in real database
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash
      }
    });

    // Invalidate all previous sessions
    await this.revokeAllUserSessions(userId, 'Password changed');

    return { success: true, message: 'Password updated successfully. All other sessions invalidated.' };
  }

  /**
   * Retrieves active sessions for a user with safe metadata (no tokens/hashes exposed).
   */
  async getUserSessions(userId: string, currentSessionId?: string | null) {
    const sessions = await prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { lastUsedAt: 'desc' }
    });

    return sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      isCurrent: currentSessionId ? s.id === currentSessionId : false
    }));
  }

  /**
   * Revokes a specific session.
   */
  async revokeSession(sessionId: string, requestingUserId: string, isAdmin: boolean = false) {
    const session = await prisma.userSession.findUnique({
      where: { id: sessionId }
    });

    if (!session) {
      const err: any = new Error('Session not found');
      err.statusCode = 404;
      throw err;
    }

    if (!isAdmin && session.userId !== requestingUserId) {
      const err: any = new Error('Forbidden: You can only revoke your own sessions');
      err.statusCode = 403;
      throw err;
    }

    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        revokedAt: new Date(),
        revokedReason: 'Revoked by user'
      }
    });

    return { success: true, message: 'Session revoked successfully' };
  }

  /**
   * Revokes all active sessions for a user.
   */
  async revokeAllUserSessions(userId: string, reason: string = 'Revoked all user sessions') {
    return prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date(),
        revokedReason: reason
      }
    });
  }

  /**
   * Loads current user profile.
   */
  async getCurrentUser(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roleName: true,
        departmentId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        department: {
          select: {
            id: true,
            name: true
          }
        },
        role: {
          select: {
            name: true,
            permissions: true,
            isSystem: true
          }
        }
      }
    });
  }
}

export const authService = new AuthService();
