import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Centralized Security Headers Middleware
 * Implements defensive HTTP headers to protect against clickjacking, MIME-sniffing,
 * cross-site framing, and insecure transports.
 */
export const securityHeadersHook = async (request: FastifyRequest, reply: FastifyReply) => {
  // Prevent MIME-sniffing
  reply.header('X-Content-Type-Options', 'nosniff');

  // Prevent framing & clickjacking
  reply.header('X-Frame-Options', 'DENY');

  // Control referrer leakage
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable legacy buggy XSS auditor in modern browsers
  reply.header('X-XSS-Protection', '0');

  // Restrict browser device feature permissions for API endpoints
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content-Security-Policy for API responses
  reply.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none';");

  // HTTP Strict Transport Security (HSTS) in production
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Attach Request ID to response
  if (request.id) {
    reply.header('x-request-id', request.id);
  }
};
