import { FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, AuthenticatedUser } from './auth.middleware';
import { auditService, SecurityEvents } from '../services/audit.service';

export type PermissionKey =
  | 'dashboard'
  | 'analytics'
  | 'campaigns'
  | 'budget'
  | 'reputation'
  | 'vendors'
  | 'reports'
  | 'integrations'
  | 'users-roles'
  | 'settings';

/**
 * Evaluates whether an authenticated user possesses a given permission.
 * Resolves permissions from authoritative database data attached to request context.
 * 
 * Rules:
 * 1. Admin role always possesses all permissions (system administrator super-role).
 * 2. Non-admin roles must explicitly have the permission set to `true` in their role permissions matrix.
 */
export function checkPermission(user: AuthenticatedUser | undefined, permissionKey: PermissionKey | string): boolean {
  if (!user || !user.isActive) {
    return false;
  }

  // Admin super-role bypass
  if (user.roleName === 'Admin' || (user.role && user.role.name === 'Admin')) {
    return true;
  }

  if (!user.role || !user.role.permissions) {
    return false;
  }

  let permissionsObj: Record<string, boolean> = {};
  if (typeof user.role.permissions === 'object' && user.role.permissions !== null) {
    permissionsObj = user.role.permissions as Record<string, boolean>;
  } else if (typeof user.role.permissions === 'string') {
    try {
      permissionsObj = JSON.parse(user.role.permissions);
    } catch {
      permissionsObj = {};
    }
  }

  return permissionsObj[permissionKey] === true;
}

/**
 * Centralized Fastify preHandler hook for RBAC permission enforcement.
 * 
 * Verifies:
 * 1. Authentication (via authenticate hook)
 * 2. Active account status
 * 3. Authoritative role & permission assigned in database
 * 
 * Returns:
 * - 401 Unauthorized if unauthenticated
 * - 403 Forbidden if authenticated but lacking required permission
 */
export function authorize(requiredPermission: PermissionKey | PermissionKey[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Ensure user is authenticated first
    if (!request.user) {
      await authenticate(request, reply);
      if (reply.sent) return;
    }

    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        success: false,
        message: 'Unauthorized: Authentication required'
      });
    }

    if (!user.isActive) {
      await auditService.log({
        action: SecurityEvents.ACCOUNT_DISABLED,
        user,
        request,
        success: false,
        failureReason: 'User account is deactivated'
      });

      return reply.status(403).send({
        success: false,
        message: 'Forbidden: User account is deactivated'
      });
    }

    // 2. Evaluate required permission(s)
    const permissionsToCheck = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
    const hasAccess = permissionsToCheck.some((perm) => checkPermission(user, perm));

    if (!hasAccess) {
      const requiredStr = Array.isArray(requiredPermission) ? requiredPermission.join(' | ') : requiredPermission;
      
      // Audit log the authorization failure
      await auditService.log({
        action: SecurityEvents.PERMISSION_DENIED,
        user,
        request,
        resourceType: Array.isArray(requiredPermission) ? requiredPermission.join(',') : requiredPermission,
        success: false,
        failureReason: `Lacks required permission: ${requiredStr}`
      });

      return reply.status(403).send({
        success: false,
        message: 'Forbidden: Insufficient permissions to access this resource',
        code: 'FORBIDDEN_INSUFFICIENT_PERMISSIONS',
        requiredPermission: requiredStr,
        userRole: user.roleName
      });
    }
  };
}

/**
 * Role-based restriction middleware for sensitive system administrative routes.
 */
export function requireRole(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      await authenticate(request, reply);
      if (reply.sent) return;
    }

    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        success: false,
        message: 'Unauthorized: Authentication required'
      });
    }

    if (!user.isActive) {
      await auditService.log({
        action: SecurityEvents.ACCOUNT_DISABLED,
        user,
        request,
        success: false,
        failureReason: 'User account is deactivated'
      });

      return reply.status(403).send({
        success: false,
        message: 'Forbidden: User account is deactivated'
      });
    }

    if (!allowedRoles.includes(user.roleName)) {
      await auditService.log({
        action: SecurityEvents.PERMISSION_DENIED,
        user,
        request,
        resourceType: 'RoleRestricted',
        success: false,
        failureReason: `Role ${user.roleName} not in allowed: ${allowedRoles.join(', ')}`
      });

      return reply.status(403).send({
        success: false,
        message: `Forbidden: Access restricted to roles: ${allowedRoles.join(', ')}`,
        code: 'FORBIDDEN_ROLE_RESTRICTED',
        userRole: user.roleName
      });
    }
  };
}
