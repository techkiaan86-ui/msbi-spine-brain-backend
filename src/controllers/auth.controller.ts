import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../services/auth.service';
import { mfaService } from '../services/mfa.service';
import {
  LoginInput,
  RefreshInput,
  ChangePasswordInput,
  RevokeSessionParams,
  MfaVerifyInput,
  MfaVerifyRecoveryInput,
  MfaVerifyEnrollmentInput,
  MfaRegenerateRecoveryInput,
  MfaDisableInput
} from '../validators/auth.schema';
import { auditService, SecurityEvents } from '../services/audit.service';

export const loginHandler = async (
  request: FastifyRequest<{ Body: LoginInput }>,
  reply: FastifyReply
) => {
  const email = request.body?.email?.trim().toLowerCase();
  const reqMeta = auditService.extractRequestMeta(request);

  try {
    const result = await authService.login(request.body, {
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent
    });

    // Check if MFA challenge is required
    if ((result as any).mfaRequired) {
      return reply.send({
        success: true,
        mfaRequired: true,
        data: result
      });
    }

    // Audit successful login for non-MFA login
    await auditService.log({
      action: SecurityEvents.LOGIN_SUCCESS,
      user: { id: (result as any).user.id, email: (result as any).user.email, roleName: (result as any).user.role },
      resourceType: 'UserSession',
      resourceId: (result as any).sessionId,
      request,
      success: true
    });

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    // Audit failed login attempt (never logs password or credentials)
    await auditService.log({
      action: SecurityEvents.LOGIN_FAILED,
      userEmail: email || 'unknown',
      request,
      success: false,
      failureReason: error.message || 'Invalid email or password'
    });

    return reply.status(401).send({ success: false, message: error.message || 'Invalid email or password' });
  }
};

export const refreshHandler = async (
  request: FastifyRequest<{ Body: RefreshInput }>,
  reply: FastifyReply
) => {
  const reqMeta = auditService.extractRequestMeta(request);

  try {
    const result = await authService.refresh(request.body.refreshToken, {
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent
    });

    await auditService.log({
      action: SecurityEvents.TOKEN_ROTATED,
      user: { id: result.user.id, email: result.user.email, roleName: result.user.role },
      resourceType: 'UserSession',
      resourceId: result.sessionId,
      request,
      success: true
    });

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    const statusCode = error.statusCode || 401;
    return reply.status(statusCode).send({ success: false, message: error.message || 'Failed to refresh token' });
  }
};

export const logoutHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const currentUser = request.user;

  if (currentUser) {
    await authService.logout(currentUser.sessionId, currentUser.id);

    await auditService.log({
      action: SecurityEvents.LOGOUT,
      user: currentUser,
      resourceType: 'UserSession',
      resourceId: currentUser.sessionId || undefined,
      request,
      success: true
    });
  }

  return reply.send({ success: true, message: 'Logged out successfully' });
};

export const getCurrentUserHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.user) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  return reply.send({ success: true, data: request.user });
};

export const changePasswordHandler = async (
  request: FastifyRequest<{ Body: ChangePasswordInput }>,
  reply: FastifyReply
) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  try {
    const result = await authService.changePassword(currentUser.id, request.body);

    await auditService.log({
      action: SecurityEvents.PASSWORD_CHANGED,
      user: currentUser,
      resourceType: 'User',
      resourceId: currentUser.id,
      request,
      success: true
    });

    return reply.send(result);
  } catch (error: any) {
    const statusCode = error.statusCode || 400;
    return reply.status(statusCode).send({ success: false, message: error.message || 'Failed to change password' });
  }
};

export const getSessionsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  const sessions = await authService.getUserSessions(currentUser.id, currentUser.sessionId);
  return reply.send({ success: true, data: sessions });
};

export const revokeSessionHandler = async (
  request: FastifyRequest<{ Params: RevokeSessionParams }>,
  reply: FastifyReply
) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  const { sessionId } = request.params;
  const isAdmin = currentUser.roleName === 'Admin';

  try {
    const result = await authService.revokeSession(sessionId, currentUser.id, isAdmin);

    await auditService.log({
      action: SecurityEvents.SESSION_REVOKED,
      user: currentUser,
      resourceType: 'UserSession',
      resourceId: sessionId,
      request,
      success: true
    });

    return reply.send(result);
  } catch (error: any) {
    const statusCode = error.statusCode || 400;
    return reply.status(statusCode).send({ success: false, message: error.message || 'Failed to revoke session' });
  }
};

export const revokeAllSessionsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  await authService.revokeAllUserSessions(currentUser.id, 'User requested revocation of all sessions');

  await auditService.log({
    action: SecurityEvents.ALL_SESSIONS_REVOKED,
    user: currentUser,
    resourceType: 'UserSession',
    request,
    success: true
  });

  return reply.send({ success: true, message: 'All active sessions have been revoked' });
};

// -----------------------------------------------------------------------------
// Multi-Factor Authentication (MFA) Handlers
// -----------------------------------------------------------------------------

export const mfaStatusHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  const status = await mfaService.getStatus(currentUser.id);
  return reply.send({ success: true, data: status });
};

export const mfaEnrollHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  const reqMeta = auditService.extractRequestMeta(request);
  const enrollmentData = await mfaService.startEnrollment(currentUser.id, currentUser.email, {
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent
  });

  return reply.send({ success: true, data: enrollmentData });
};

export const mfaVerifyEnrollmentHandler = async (
  request: FastifyRequest<{ Body: MfaVerifyEnrollmentInput }>,
  reply: FastifyReply
) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  const reqMeta = auditService.extractRequestMeta(request);

  try {
    const result = await mfaService.verifyEnrollment(currentUser.id, request.body.code, {
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent
    });

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    const statusCode = error.statusCode || 400;
    return reply.status(statusCode).send({ success: false, message: error.message || 'MFA verification failed' });
  }
};

export const mfaVerifyLoginHandler = async (
  request: FastifyRequest<{ Body: MfaVerifyInput }>,
  reply: FastifyReply
) => {
  const reqMeta = auditService.extractRequestMeta(request);

  try {
    const result = await mfaService.verifyLoginTotp(request.body.mfaChallenge, request.body.code, {
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent
    });

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    const statusCode = error.statusCode || 401;
    return reply.status(statusCode).send({ success: false, message: error.message || 'MFA verification failed' });
  }
};

export const mfaVerifyRecoveryLoginHandler = async (
  request: FastifyRequest<{ Body: MfaVerifyRecoveryInput }>,
  reply: FastifyReply
) => {
  const reqMeta = auditService.extractRequestMeta(request);

  try {
    const result = await mfaService.verifyLoginRecoveryCode(request.body.mfaChallenge, request.body.recoveryCode, {
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent
    });

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    const statusCode = error.statusCode || 401;
    return reply.status(statusCode).send({ success: false, message: error.message || 'Recovery code verification failed' });
  }
};

export const mfaRegenerateRecoveryHandler = async (
  request: FastifyRequest<{ Body: MfaRegenerateRecoveryInput }>,
  reply: FastifyReply
) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  try {
    const result = await mfaService.regenerateRecoveryCodes(
      currentUser.id,
      request.body.currentPassword,
      request.body.code
    );

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    const statusCode = error.statusCode || 400;
    return reply.status(statusCode).send({ success: false, message: error.message || 'Failed to regenerate recovery codes' });
  }
};

export const mfaDisableHandler = async (
  request: FastifyRequest<{ Body: MfaDisableInput }>,
  reply: FastifyReply
) => {
  const currentUser = request.user;
  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  try {
    const result = await mfaService.disableMfa(
      currentUser.id,
      request.body.currentPassword,
      request.body.code,
      request.body.recoveryCode
    );

    return reply.send({ success: true, data: result });
  } catch (error: any) {
    const statusCode = error.statusCode || 400;
    return reply.status(statusCode).send({ success: false, message: error.message || 'Failed to disable MFA' });
  }
};
