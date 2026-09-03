import { FastifyRequest, FastifyReply } from 'fastify';
import { usersService } from '../services/users.service';
import { CreateUserInput } from '../validators/users.schema';
import { ResourceAuth } from '../utils/resource-auth';
import { auditService, SecurityEvents, AuditQueryFilters } from '../services/audit.service';

export const getUsersHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const users = await usersService.getAllUsers();
  return reply.send({ success: true, data: users });
};

export const createUserHandler = async (
  request: FastifyRequest<{ Body: CreateUserInput }>,
  reply: FastifyReply
) => {
  const currentUser = request.user;
  try {
    const user = await usersService.createUser(request.body);
    
    // Audit user creation
    await auditService.log({
      action: SecurityEvents.USER_CREATED,
      user: currentUser,
      resourceType: 'User',
      resourceId: user.id,
      request,
      success: true
    });

    // Exclude password from response
    const { passwordHash, ...safeUser } = user;
    return reply.status(201).send({ success: true, data: safeUser });
  } catch (err: any) {
    await auditService.log({
      action: SecurityEvents.USER_CREATED,
      user: currentUser,
      resourceType: 'User',
      request,
      success: false,
      failureReason: err.message || 'Failed to create user'
    });

    return reply.status(400).send({ success: false, message: 'Email already exists or invalid data.' });
  }
};

export const getRolesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const roles = await usersService.getRoles();
  return reply.send({ success: true, data: roles });
};

export const getActivityLogsHandler = async (
  request: FastifyRequest<{ Querystring: AuditQueryFilters }>,
  reply: FastifyReply
) => {
  const currentUser = request.user;
  const result = await auditService.getLogs(request.query);

  // Audit viewing of the security audit log itself
  await auditService.log({
    action: SecurityEvents.AUDIT_LOG_VIEW,
    user: currentUser,
    resourceType: 'ActivityLog',
    request,
    success: true
  });

  return reply.send({ success: true, data: result.logs, pagination: result.pagination });
};

export const updateNotificationPreferencesHandler = async (
  request: FastifyRequest<{ 
    Params: { id: string }; 
    Body: { phoneNumber?: string | null; emailAlerts: boolean; smsAlerts: boolean; alertLocations?: string[] | null } 
  }>,
  reply: FastifyReply
) => {
  const { id } = request.params;
  const currentUser = request.user;

  if (!currentUser) {
    return reply.status(401).send({ success: false, message: 'Unauthorized' });
  }

  // Resource-Level Authorization / IDOR Protection
  if (!ResourceAuth.canAccessUser(currentUser, id)) {
    await auditService.log({
      action: SecurityEvents.PERMISSION_DENIED,
      user: currentUser,
      resourceType: 'UserNotifications',
      resourceId: id,
      request,
      success: false,
      failureReason: 'IDOR attempt to modify notification preferences of another user'
    });

    return reply.status(403).send({
      success: false,
      message: 'Forbidden: You do not have permission to modify another user\'s notification preferences',
      code: 'FORBIDDEN_RESOURCE_ACCESS'
    });
  }

  const { phoneNumber, emailAlerts, smsAlerts, alertLocations } = request.body;
  try {
    const user = await usersService.updateNotificationPreferences(id, {
      phoneNumber,
      emailAlerts,
      smsAlerts,
      alertLocations
    });
    if (!user) {
      return reply.status(404).send({ success: false, message: 'User not found' });
    }

    await auditService.log({
      action: SecurityEvents.USER_UPDATED,
      user: currentUser,
      resourceType: 'UserNotifications',
      resourceId: id,
      request,
      success: true
    });

    const { passwordHash, ...safeUser } = user as any;
    return reply.send({ success: true, data: safeUser });
  } catch (err: any) {
    return reply.status(500).send({ success: false, error: err.message });
  }
};
