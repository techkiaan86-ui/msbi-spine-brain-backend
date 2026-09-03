import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';

export const errorHandler = (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
  // Log detailed error internally on server (with automatic secret redaction)
  logger.error(error);

  // 1. Request Body Size Limit Exceeded (413 Payload Too Large)
  if (error.statusCode === 413 || (error as any).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return reply.status(413).send({
      success: false,
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Request entity exceeds maximum allowable size'
    });
  }

  // 2. Unsupported Content Type (415 Unsupported Media Type)
  if (error.statusCode === 415 || (error as any).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return reply.status(415).send({
      success: false,
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: 'Unsupported content type header'
    });
  }

  // 3. Rate Limit Exceeded (429 Too Many Requests)
  if (error.statusCode === 429) {
    return reply.status(429).send({
      success: false,
      statusCode: 429,
      error: 'Too Many Requests',
      message: error.message || 'Rate limit exceeded'
    });
  }

  // 4. Schema / Input Validation Errors (400 Bad Request)
  if (error.validation || (error as any).issues) {
    return reply.status(400).send({
      success: false,
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation Error',
      errors: error.validation || (error as any).issues,
    });
  }

  // 5. Explicit Client/Auth Errors (400, 401, 403, 404)
  const statusCode = error.statusCode || 500;
  if (statusCode >= 400 && statusCode < 500) {
    return reply.status(statusCode).send({
      success: false,
      statusCode,
      message: error.message || 'Client Error'
    });
  }

  // 6. Internal Server Errors (500) - Never leak database strings, paths, or stack traces
  const safeMessage = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error' 
    : (error.message || 'Internal Server Error');

  reply.status(500).send({
    success: false,
    statusCode: 500,
    message: safeMessage
  });
};
