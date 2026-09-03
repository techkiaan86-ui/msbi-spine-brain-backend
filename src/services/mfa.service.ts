import prisma from '../plugins/db';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { encryptCredential, decryptCredential } from '../utils/crypto';
import { getJwtSecret, getJwtExpiresIn } from '../middlewares/auth.middleware';
import { auditService, SecurityEvents } from './audit.service';
import { authService, RequestSessionMeta } from './auth.service';

export class MfaService {
  /**
   * Hashes a challenge token or recovery code using SHA-256 for secure database indexing.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  /**
   * Normalizes and hashes a recovery code.
   */
  hashRecoveryCode(code: string): string {
    const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return this.hashToken(normalized);
  }

  /**
   * Formats a raw 10-char code into human-friendly format: XXXX-XXXX
   */
  formatRecoveryCode(rawCode: string): string {
    const clean = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length === 8) {
      return `${clean.slice(0, 4)}-${clean.slice(4)}`;
    }
    return clean;
  }

  /**
   * Generates 10 cryptographically random, high-entropy recovery codes.
   */
  generateRecoveryCodes(count = 10): string[] {
    const codes: string[] = [];
    const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 without ambiguous 0/O, 1/I
    for (let i = 0; i < count; i++) {
      let code = '';
      const randomBytes = crypto.randomBytes(8);
      for (let j = 0; j < 8; j++) {
        code += charset[randomBytes[j] % charset.length];
      }
      codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }
    return codes;
  }

  /**
   * Retrieves the current user's safe MFA configuration status.
   * Never exposes TOTP secrets or recovery code hashes.
   */
  async getStatus(userId: string) {
    const [mfa, recoveryCount] = await Promise.all([
      prisma.userMFA.findUnique({
        where: { userId },
        select: {
          enabled: true,
          verifiedAt: true,
          enabledAt: true,
          lastUsedAt: true,
          createdAt: true
        }
      }),
      prisma.userMFARecoveryCode.count({
        where: {
          userId,
          usedAt: null
        }
      })
    ]);

    return {
      enabled: mfa?.enabled || false,
      verifiedAt: mfa?.verifiedAt || null,
      enabledAt: mfa?.enabledAt || null,
      lastUsedAt: mfa?.lastUsedAt || null,
      remainingRecoveryCodes: recoveryCount
    };
  }

  /**
   * Begins MFA enrollment by generating a 160-bit TOTP secret, encrypting it at rest with AES-256-GCM,
   * saving a pending UserMFA record (enabled: false), and generating the provisioning QR Code.
   */
  async startEnrollment(userId: string, userEmail: string, meta?: RequestSessionMeta) {
    // Generate standard 160-bit (20 bytes) Base32 secret
    const secret = new OTPAuth.Secret({ size: 20 });
    const secretBase32 = secret.base32;

    const encryptedSecret = encryptCredential(secretBase32);
    if (!encryptedSecret) {
      throw new Error('Failed to encrypt MFA secret at rest');
    }

    // Upsert pending UserMFA record (enabled remains false until verified)
    await prisma.userMFA.upsert({
      where: { userId },
      create: {
        userId,
        secretEncrypted: encryptedSecret,
        enabled: false
      },
      update: {
        secretEncrypted: encryptedSecret,
        enabled: false,
        verifiedAt: null,
        enabledAt: null
      }
    });

    const totp = new OTPAuth.TOTP({
      issuer: 'Midwest Spine & Brain Institute',
      label: userEmail,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret
    });

    const otpauthUri = totp.toString();
    const qrCode = await QRCode.toDataURL(otpauthUri, {
      margin: 2,
      width: 256,
      errorCorrectionLevel: 'M'
    });

    await auditService.log({
      action: SecurityEvents.MFA_ENROLLMENT_STARTED,
      userId,
      userEmail,
      resourceType: 'UserMFA',
      success: true
    });

    return {
      qrCode,
      otpauthUri,
      secret: secretBase32
    };
  }

  /**
   * Verifies the first TOTP code to complete enrollment, sets enabled = true,
   * and generates 10 single-use hashed recovery codes.
   */
  async verifyEnrollment(userId: string, code: string, meta?: RequestSessionMeta) {
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      const err: any = new Error('Invalid verification code: 6 numeric digits required');
      err.statusCode = 400;
      throw err;
    }

    const mfa = await prisma.userMFA.findUnique({
      where: { userId },
      include: { user: true }
    });

    if (!mfa || !mfa.secretEncrypted) {
      const err: any = new Error('MFA enrollment has not been initiated');
      err.statusCode = 400;
      throw err;
    }

    const secretBase32 = decryptCredential(mfa.secretEncrypted);
    if (!secretBase32) {
      throw new Error('Unable to decrypt MFA secret');
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'Midwest Spine & Brain Institute',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32)
    });

    const delta = totp.validate({ token: code.trim(), window: 1 });
    if (delta === null) {
      await auditService.log({
        action: SecurityEvents.MFA_VERIFICATION_FAILED,
        userId,
        userEmail: mfa.user.email,
        userRole: mfa.user.roleName,
        resourceType: 'UserMFA',
        success: false,
        failureReason: 'Invalid code provided during MFA enrollment verification'
      });

      const err: any = new Error('Invalid MFA verification code');
      err.statusCode = 400;
      throw err;
    }

    const rawRecoveryCodes = this.generateRecoveryCodes(10);
    const now = new Date();

    // Atomic transaction: enable MFA and store hashed recovery codes in a single batch query
    await prisma.$transaction(async (tx) => {
      await tx.userMFA.update({
        where: { userId },
        data: {
          enabled: true,
          verifiedAt: now,
          enabledAt: now,
          lastUsedAt: now
        }
      });

      // Clear any previous recovery codes
      await tx.userMFARecoveryCode.deleteMany({
        where: { userId }
      });

      // Insert all 10 hashed recovery codes in a single fast atomic batch insert
      await tx.userMFARecoveryCode.createMany({
        data: rawRecoveryCodes.map((rawCode) => ({
          userId,
          codeHash: this.hashRecoveryCode(rawCode),
          createdAt: now
        }))
      });
    }, { timeout: 15000 });

    await auditService.log({
      action: SecurityEvents.MFA_ENROLLMENT_VERIFIED,
      userId,
      userEmail: mfa.user.email,
      userRole: mfa.user.roleName,
      resourceType: 'UserMFA',
      success: true
    });

    await auditService.log({
      action: SecurityEvents.MFA_ENABLED,
      userId,
      userEmail: mfa.user.email,
      userRole: mfa.user.roleName,
      resourceType: 'UserMFA',
      success: true
    });

    return {
      success: true,
      message: 'MFA successfully verified and enabled',
      recoveryCodes: rawRecoveryCodes
    };
  }

  /**
   * Generates a short-lived (5-minute TTL), single-use MFA challenge token after valid password verification.
   */
  async createLoginChallenge(userId: string, meta?: RequestSessionMeta): Promise<string> {
    const rawChallengeToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawChallengeToken);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await prisma.userMFAChallenge.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress: meta?.ipAddress || null,
        userAgent: meta?.userAgent ? meta.userAgent.slice(0, 500) : null
      }
    });

    return rawChallengeToken;
  }

  /**
   * Verifies an MFA login challenge and TOTP code.
   * Upon success, consumes challenge and issues an authoritative UserSession + JWT tokens.
   */
  async verifyLoginTotp(mfaChallenge: string, code: string, meta?: RequestSessionMeta) {
    if (!mfaChallenge || typeof mfaChallenge !== 'string') {
      const err: any = new Error('MFA challenge token is required');
      err.statusCode = 400;
      throw err;
    }

    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      const err: any = new Error('Invalid MFA verification code: 6 numeric digits required');
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = this.hashToken(mfaChallenge);
    const now = new Date();

    const challenge = await prisma.userMFAChallenge.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            role: true,
            department: true,
            mfa: true
          }
        }
      }
    });

    if (!challenge) {
      const err: any = new Error('Invalid or expired MFA challenge');
      err.statusCode = 401;
      throw err;
    }

    // Replay attack prevention
    if (challenge.usedAt) {
      await auditService.log({
        action: SecurityEvents.MFA_CHALLENGE_REPLAY_BLOCKED,
        userId: challenge.userId,
        userEmail: challenge.user.email,
        userRole: challenge.user.roleName,
        resourceType: 'UserMFAChallenge',
        resourceId: challenge.id,
        success: false,
        failureReason: 'Attempted replay of already consumed MFA challenge token'
      });

      const err: any = new Error('MFA challenge has already been used');
      err.statusCode = 401;
      throw err;
    }

    // Expiration check
    if (challenge.expiresAt < now) {
      await auditService.log({
        action: SecurityEvents.MFA_CHALLENGE_EXPIRED,
        userId: challenge.userId,
        userEmail: challenge.user.email,
        userRole: challenge.user.roleName,
        resourceType: 'UserMFAChallenge',
        resourceId: challenge.id,
        success: false,
        failureReason: 'MFA challenge expired'
      });

      const err: any = new Error('MFA challenge has expired. Please log in again.');
      err.statusCode = 401;
      throw err;
    }

    const user = challenge.user;
    if (!user || !user.isActive) {
      const err: any = new Error('User account is deactivated');
      err.statusCode = 403;
      throw err;
    }

    if (!user.mfa || !user.mfa.enabled || !user.mfa.secretEncrypted) {
      const err: any = new Error('MFA is not enabled for this user');
      err.statusCode = 400;
      throw err;
    }

    const secretBase32 = decryptCredential(user.mfa.secretEncrypted);
    if (!secretBase32) {
      throw new Error('Unable to decrypt MFA secret');
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'Midwest Spine & Brain Institute',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32)
    });

    const delta = totp.validate({ token: code.trim(), window: 1 });
    if (delta === null) {
      await auditService.log({
        action: SecurityEvents.MFA_VERIFICATION_FAILED,
        userId: user.id,
        userEmail: user.email,
        userRole: user.roleName,
        resourceType: 'UserMFA',
        success: false,
        failureReason: 'Invalid TOTP code'
      });

      const err: any = new Error('Invalid MFA verification code');
      err.statusCode = 401;
      throw err;
    }

    // Atomic: consume challenge, update MFA lastUsedAt, create UserSession
    const rawRefreshToken = authService.generateRefreshToken();
    const refreshTokenHash = authService.hashToken(rawRefreshToken);
    const sessionExpiresAt = authService.getSessionExpiresAt();

    const session = await prisma.$transaction(async (tx) => {
      const challengeUpdate = await tx.userMFAChallenge.updateMany({
        where: { id: challenge.id, usedAt: null },
        data: { usedAt: now }
      });

      if (challengeUpdate.count === 0) {
        throw new Error('MFA challenge has already been used. Please log in again.');
      }

      await tx.userMFA.update({
        where: { userId: user.id },
        data: { lastUsedAt: now }
      });

      return tx.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash,
          ipAddress: meta?.ipAddress || challenge.ipAddress,
          userAgent: meta?.userAgent ? meta.userAgent.slice(0, 500) : challenge.userAgent,
          expiresAt: sessionExpiresAt,
          lastUsedAt: now
        }
      });
    }, { timeout: 15000 });

    const secret = getJwtSecret();
    const expiresIn = getJwtExpiresIn();

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

    await auditService.log({
      action: SecurityEvents.MFA_VERIFICATION_SUCCESS,
      userId: user.id,
      userEmail: user.email,
      userRole: user.roleName,
      resourceType: 'UserSession',
      resourceId: session.id,
      success: true
    });

    await auditService.log({
      action: SecurityEvents.LOGIN_SUCCESS,
      userId: user.id,
      userEmail: user.email,
      userRole: user.roleName,
      resourceType: 'UserSession',
      resourceId: session.id,
      success: true
    });

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
   * Verifies an MFA login challenge with a one-time hashed recovery code.
   * Atomically consumes the recovery code and challenge, then issues an authenticated session.
   */
  async verifyLoginRecoveryCode(mfaChallenge: string, recoveryCode: string, meta?: RequestSessionMeta) {
    if (!mfaChallenge || typeof mfaChallenge !== 'string') {
      const err: any = new Error('MFA challenge token is required');
      err.statusCode = 400;
      throw err;
    }

    if (!recoveryCode || typeof recoveryCode !== 'string') {
      const err: any = new Error('Recovery code is required');
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = this.hashToken(mfaChallenge);
    const codeHash = this.hashRecoveryCode(recoveryCode);
    const now = new Date();

    const challenge = await prisma.userMFAChallenge.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            role: true,
            department: true,
            mfa: true
          }
        }
      }
    });

    if (!challenge) {
      const err: any = new Error('Invalid or expired MFA challenge');
      err.statusCode = 401;
      throw err;
    }

    if (challenge.usedAt) {
      await auditService.log({
        action: SecurityEvents.MFA_CHALLENGE_REPLAY_BLOCKED,
        userId: challenge.userId,
        userEmail: challenge.user.email,
        userRole: challenge.user.roleName,
        resourceType: 'UserMFAChallenge',
        resourceId: challenge.id,
        success: false,
        failureReason: 'Attempted replay of already consumed MFA challenge token'
      });

      const err: any = new Error('MFA challenge has already been used');
      err.statusCode = 401;
      throw err;
    }

    if (challenge.expiresAt < now) {
      await auditService.log({
        action: SecurityEvents.MFA_CHALLENGE_EXPIRED,
        userId: challenge.userId,
        userEmail: challenge.user.email,
        userRole: challenge.user.roleName,
        resourceType: 'UserMFAChallenge',
        resourceId: challenge.id,
        success: false,
        failureReason: 'MFA challenge expired'
      });

      const err: any = new Error('MFA challenge has expired. Please log in again.');
      err.statusCode = 401;
      throw err;
    }

    const user = challenge.user;
    if (!user || !user.isActive) {
      const err: any = new Error('User account is deactivated');
      err.statusCode = 403;
      throw err;
    }

    if (!user.mfa || !user.mfa.enabled) {
      const err: any = new Error('MFA is not enabled for this user');
      err.statusCode = 400;
      throw err;
    }

    // Atomic transaction to consume matching unused recovery code
    const rawRefreshToken = authService.generateRefreshToken();
    const refreshTokenHash = authService.hashToken(rawRefreshToken);
    const sessionExpiresAt = authService.getSessionExpiresAt();

    const { session, remainingCount } = await prisma.$transaction(async (tx) => {
      const recoveryUpdate = await tx.userMFARecoveryCode.updateMany({
        where: {
          userId: user.id,
          codeHash,
          usedAt: null
        },
        data: { usedAt: now }
      });

      if (recoveryUpdate.count === 0) {
        throw new Error('INVALID_RECOVERY_CODE');
      }

      const challengeUpdate = await tx.userMFAChallenge.updateMany({
        where: { id: challenge.id, usedAt: null },
        data: { usedAt: now }
      });

      if (challengeUpdate.count === 0) {
        throw new Error('CHALLENGE_ALREADY_USED');
      }

      await tx.userMFA.update({
        where: { userId: user.id },
        data: { lastUsedAt: now }
      });

      const newSession = await tx.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash,
          ipAddress: meta?.ipAddress || challenge.ipAddress,
          userAgent: meta?.userAgent ? meta.userAgent.slice(0, 500) : challenge.userAgent,
          expiresAt: sessionExpiresAt,
          lastUsedAt: now
        }
      });

      const remaining = await tx.userMFARecoveryCode.count({
        where: {
          userId: user.id,
          usedAt: null
        }
      });

      return { session: newSession, remainingCount: remaining };
    }, { timeout: 15000 }).catch(async (err) => {
      if (err.message === 'INVALID_RECOVERY_CODE') {
        await auditService.log({
          action: SecurityEvents.MFA_VERIFICATION_FAILED,
          userId: user.id,
          userEmail: user.email,
          userRole: user.roleName,
          resourceType: 'UserMFARecoveryCode',
          success: false,
          failureReason: 'Invalid or already used recovery code'
        });

        const customErr: any = new Error('Invalid recovery code');
        customErr.statusCode = 401;
        throw customErr;
      }
      throw err;
    });

    const secret = getJwtSecret();
    const expiresIn = getJwtExpiresIn();

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

    await auditService.log({
      action: SecurityEvents.MFA_RECOVERY_CODE_USED,
      userId: user.id,
      userEmail: user.email,
      userRole: user.roleName,
      resourceType: 'UserMFARecoveryCode',
      resourceId: session.id,
      success: true
    });

    await auditService.log({
      action: SecurityEvents.LOGIN_SUCCESS,
      userId: user.id,
      userEmail: user.email,
      userRole: user.roleName,
      resourceType: 'UserSession',
      resourceId: session.id,
      success: true
    });

    return {
      token: accessToken,
      refreshToken: rawRefreshToken,
      sessionId: session.id,
      remainingRecoveryCodes: remainingCount,
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
   * Regenerates a new set of 10 recovery codes. Requires strong re-authentication (current password + TOTP).
   */
  async regenerateRecoveryCodes(userId: string, currentPassword: string, code: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { mfa: true }
    });

    if (!user) {
      const err: any = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      const err: any = new Error('Invalid current password');
      err.statusCode = 400;
      throw err;
    }

    if (!user.mfa || !user.mfa.enabled || !user.mfa.secretEncrypted) {
      const err: any = new Error('MFA is not enabled');
      err.statusCode = 400;
      throw err;
    }

    const secretBase32 = decryptCredential(user.mfa.secretEncrypted);
    if (!secretBase32) {
      throw new Error('Unable to decrypt MFA secret');
    }

    const totp = new OTPAuth.TOTP({
      issuer: 'Midwest Spine & Brain Institute',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32)
    });

    const delta = totp.validate({ token: code.trim(), window: 1 });
    if (delta === null) {
      const err: any = new Error('Invalid MFA verification code');
      err.statusCode = 400;
      throw err;
    }

    const rawRecoveryCodes = this.generateRecoveryCodes(10);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.userMFARecoveryCode.deleteMany({
        where: { userId }
      });

      await tx.userMFARecoveryCode.createMany({
        data: rawRecoveryCodes.map((rawCode) => ({
          userId,
          codeHash: this.hashRecoveryCode(rawCode),
          createdAt: now
        }))
      });
    }, { timeout: 15000 });

    await auditService.log({
      action: SecurityEvents.MFA_RECOVERY_CODES_REGENERATED,
      userId: user.id,
      userEmail: user.email,
      userRole: user.roleName,
      resourceType: 'UserMFARecoveryCode',
      success: true
    });

    return {
      success: true,
      message: 'Recovery codes successfully regenerated',
      recoveryCodes: rawRecoveryCodes
    };
  }

  /**
   * Disables MFA for an account. High-risk operation requiring re-authentication:
   * Current Password + (Current TOTP OR Unused Recovery Code).
   */
  async disableMfa(
    userId: string,
    currentPassword: string,
    code?: string,
    recoveryCode?: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { mfa: true }
    });

    if (!user) {
      const err: any = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      const err: any = new Error('Invalid current password');
      err.statusCode = 400;
      throw err;
    }

    if (!user.mfa || !user.mfa.enabled) {
      const err: any = new Error('MFA is not enabled for this user');
      err.statusCode = 400;
      throw err;
    }

    let verifiedFactor = false;

    // Try TOTP first
    if (code && typeof code === 'string' && /^\d{6}$/.test(code.trim())) {
      const secretBase32 = decryptCredential(user.mfa.secretEncrypted);
      if (secretBase32) {
        const totp = new OTPAuth.TOTP({
          issuer: 'Midwest Spine & Brain Institute',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          secret: OTPAuth.Secret.fromBase32(secretBase32)
        });
        const delta = totp.validate({ token: code.trim(), window: 1 });
        if (delta !== null) {
          verifiedFactor = true;
        }
      }
    }

    // Try recovery code if TOTP wasn't provided or didn't match
    if (!verifiedFactor && recoveryCode && typeof recoveryCode === 'string') {
      const codeHash = this.hashRecoveryCode(recoveryCode);
      const matchedRecovery = await prisma.userMFARecoveryCode.findFirst({
        where: {
          userId,
          codeHash,
          usedAt: null
        }
      });
      if (matchedRecovery) {
        verifiedFactor = true;
      }
    }

    if (!verifiedFactor) {
      await auditService.log({
        action: SecurityEvents.MFA_VERIFICATION_FAILED,
        userId: user.id,
        userEmail: user.email,
        userRole: user.roleName,
        resourceType: 'UserMFA',
        success: false,
        failureReason: 'Invalid MFA code or recovery code provided during disable attempt'
      });

      const err: any = new Error('Invalid MFA code or recovery code');
      err.statusCode = 400;
      throw err;
    }

    // Atomic: delete MFA, recovery codes, and pending challenges
    await prisma.$transaction(async (tx) => {
      await tx.userMFA.deleteMany({
        where: { userId }
      });
      await tx.userMFARecoveryCode.deleteMany({
        where: { userId }
      });
      await tx.userMFAChallenge.deleteMany({
        where: { userId }
      });
    }, { timeout: 15000 });

    await auditService.log({
      action: SecurityEvents.MFA_DISABLED,
      userId: user.id,
      userEmail: user.email,
      userRole: user.roleName,
      resourceType: 'UserMFA',
      success: true
    });

    return {
      success: true,
      message: 'Multi-Factor Authentication has been successfully disabled'
    };
  }
}

export const mfaService = new MfaService();
