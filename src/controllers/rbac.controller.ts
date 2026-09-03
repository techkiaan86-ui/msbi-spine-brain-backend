import { FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../plugins/db';
import { z } from 'zod';
import { auditService, SecurityEvents } from '../services/audit.service';

const createRoleSchema = z.object({
  name: z.string().min(2),
  permissions: z.record(z.string(), z.boolean()).optional()
});

const updateRoleSchema = z.object({
  permissions: z.record(z.string(), z.boolean())
});

export const getRolesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { createdAt: 'asc' }
    });
    return reply.send({ success: true, data: roles });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};

export const createRoleHandler = async (request: FastifyRequest, reply: FastifyReply) => {
  const currentUser = request.user;
  try {
    const data = createRoleSchema.parse(request.body);
    
    // Check if role exists
    const existing = await prisma.role.findUnique({ where: { name: data.name } });
    if (existing) {
      return reply.status(400).send({ success: false, message: 'Role already exists' });
    }

    const role = await prisma.role.create({
      data: {
        name: data.name,
        permissions: (data.permissions || {}) as any,
        isSystem: false
      }
    });

    await auditService.log({
      action: SecurityEvents.ROLE_CHANGED,
      user: currentUser,
      resourceType: 'Role',
      resourceId: role.name,
      request,
      success: true
    });

    return reply.status(201).send({ success: true, data: role });
  } catch (error: any) {
    return reply.status(400).send({ success: false, message: error.message });
  }
};

export const updateRolePermissionsHandler = async (
  request: FastifyRequest<{ Params: { name: string } }>, 
  reply: FastifyReply
) => {
  const currentUser = request.user;
  try {
    const { name } = request.params;
    const data = updateRoleSchema.parse(request.body);

    const role = await prisma.role.findUnique({ where: { name } });
    if (!role) {
      return reply.status(404).send({ success: false, message: 'Role not found' });
    }

    const updated = await prisma.role.update({
      where: { name },
      data: { permissions: data.permissions as any }
    });

    await auditService.log({
      action: SecurityEvents.PERMISSION_CHANGED,
      user: currentUser,
      resourceType: 'Role',
      resourceId: name,
      request,
      success: true
    });

    return reply.send({ success: true, data: updated });
  } catch (error: any) {
    return reply.status(400).send({ success: false, message: error.message });
  }
};

export const deleteRoleHandler = async (
  request: FastifyRequest<{ Params: { name: string } }>, 
  reply: FastifyReply
) => {
  const currentUser = request.user;
  try {
    const { name } = request.params;
    
    const role = await prisma.role.findUnique({ where: { name } });
    if (!role) {
      return reply.status(404).send({ success: false, message: 'Role not found' });
    }

    if (role.isSystem) {
      await auditService.log({
        action: SecurityEvents.PERMISSION_DENIED,
        user: currentUser,
        resourceType: 'Role',
        resourceId: name,
        request,
        success: false,
        failureReason: 'Cannot delete system roles'
      });
      return reply.status(403).send({ success: false, message: 'Cannot delete system roles' });
    }

    // Security fix: Reject deletion if users are still assigned to this role
    const assignedUsersCount = await prisma.user.count({ where: { roleName: name } });
    if (assignedUsersCount > 0) {
      return reply.status(400).send({ 
        success: false, 
        message: `Cannot delete role '${name}' because it is assigned to ${assignedUsersCount} active user(s). Reassign them first.` 
      });
    }

    await prisma.role.delete({ where: { name } });

    await auditService.log({
      action: SecurityEvents.ROLE_CHANGED,
      user: currentUser,
      resourceType: 'Role',
      resourceId: name,
      request,
      success: true
    });

    return reply.send({ success: true, message: 'Role deleted successfully' });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
};
