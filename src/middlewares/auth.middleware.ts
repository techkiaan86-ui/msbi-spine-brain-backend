import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import prisma from '../plugins/db';

export interface TokenPayload {
  userId: string;
  sessionId?: string;
  email?: string;
  role?: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleName: string;
  departmentId: string | null;
  isActive: boolean;
  sessionId?: string | null;
  role?: {
    name: string;
    permissions: any;
    isSystem: boolean;
  } | null;
  department?: {
    id: string;
    name: string;
  } | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

/**
 * Retrieves the JWT Secret from environment variables.
 * Fails closed if the secret is missing or empty.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error('FATAL SECURITY CONFIGURATION: JWT_SECRET environment variable is missing. Authentication cannot proceed.');
  }
  return secret.trim();
}

/**
 * Retrieves the configured JWT access token expiration (defaults to '15m').
 */
export function getJwtExpiresIn(): string {
  return process.env.JWT_ACCESS_TOKEN_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m';
}

/**
 * Synchronously or asynchronously verifies a JWT string and returns its decoded payload.
 */
export function verifyJwtToken(token: string): TokenPayload {
  const secret = getJwtSecret();
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256']
    }) as TokenPayload;

    if (!decoded || typeof decoded !== 'object' || !decoded.userId) {
      throw new Error('Token payload missing required userId claim');
    }

    return decoded;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      const err: any = new Error('Token has expired');
      err.statusCode = 401;
      err.code = 'TOKEN_EXPIRED';
      throw err;
    }
    if (error.name === 'JsonWebTokenError') {
      const err: any = new Error('Invalid token signature or format');
      err.statusCode = 401;
      err.code = 'INVALID_TOKEN';
      throw err;
    }
    throw error;
  }
}

/**
 * Centralized Fastify preHandler hook for route authentication.
 * 
 * Verifies:
 * 1. Authorization header format (Bearer <token>)
 * 2. JWT signature, algorithm, expiration & claims
 * 3. Session validity in MySQL if sessionId claim is present
 * 4. User existence and active status in the real MySQL database
 * 5. Attaches authoritative user data & sessionId to request.user
 */
export const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
  let authHeader = request.headers.authorization;

  if (!authHeader && request.query && typeof request.query === 'object') {
    const query = request.query as any;
    if (query.token && typeof query.token === 'string') {
      authHeader = `Bearer ${query.token}`;
    }
  }

  if (!authHeader || typeof authHeader !== 'string') {
    return reply.status(401).send({
      success: false,
      message: 'Unauthorized: Missing Authorization header'
    });
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    return reply.status(401).send({
      success: false,
      message: 'Unauthorized: Malformed Authorization header. Expected format: Bearer <token>'
    });
  }

  const token = parts[1];

  let payload: TokenPayload;
  try {
    payload = verifyJwtToken(token);
  } catch (error: any) {
    const statusCode = error.statusCode || 401;
    return reply.status(statusCode).send({
      success: false,
      message: error.message || 'Unauthorized: Token validation failed'
    });
  }

  // If the token is bound to a server-side session, verify session validity
  if (payload.sessionId) {
    try {
      const session = await prisma.userSession.findUnique({
        where: { id: payload.sessionId }
      });

      if (!session) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized: Session not found',
          code: 'SESSION_NOT_FOUND'
        });
      }

      if (session.revokedAt) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized: Session has been revoked',
          code: 'SESSION_REVOKED'
        });
      }

      if (session.expiresAt < new Date()) {
        return reply.status(401).send({
          success: false,
          message: 'Unauthorized: Session has expired',
          code: 'SESSION_EXPIRED'
        });
      }

      // Update session lastUsedAt asynchronously without blocking request
      prisma.userSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() }
      }).catch(() => {});
    } catch (sessionErr: any) {
      request.log.error({ err: sessionErr }, 'Error checking user session in database');
      return reply.status(500).send({
        success: false,
        message: 'Internal Server Error during session validation'
      });
    }
  }

  // Load authoritative user from the real database
  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        role: true,
        department: true
      }
    });

    if (!dbUser) {
      return reply.status(401).send({
        success: false,
        message: 'Unauthorized: User account not found'
      });
    }

    if (!dbUser.isActive) {
      return reply.status(403).send({
        success: false,
        message: 'Forbidden: User account is deactivated'
      });
    }

    // Attach authoritative database user information to request context
    request.user = {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      roleName: dbUser.roleName,
      departmentId: dbUser.departmentId,
      isActive: dbUser.isActive,
      sessionId: payload.sessionId || null,
      role: dbUser.role ? {
        name: dbUser.role.name,
        permissions: dbUser.role.permissions,
        isSystem: dbUser.role.isSystem
      } : null,
      department: dbUser.department ? {
        id: dbUser.department.id,
        name: dbUser.department.name
      } : null
    };
  } catch (dbError: any) {
    request.log.error({ err: dbError }, 'Database error during authentication lookup');
    return reply.status(500).send({
      success: false,
      message: 'Internal Server Error during authentication'
    });
  }
};
