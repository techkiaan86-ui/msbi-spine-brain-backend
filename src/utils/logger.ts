import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-webhook-secret"]',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'refreshTokenHash',
      'apiKey',
      'secret',
      'clientSecret',
      'jwtSecret',
      'encryptionKey',
      'authorization',
      'credentials',
      'ssn',
      'creditCard',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.refreshTokenHash',
      '*.accessToken',
      '*.secret',
      '*.clientSecret',
      '*.apiKey',
      '*.credentials',
      '*.ssn',
      '*.creditCard'
    ],
    censor: '[REDACTED]'
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});
