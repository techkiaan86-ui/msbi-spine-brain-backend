import dotenv from 'dotenv';
dotenv.config();

import { buildApp } from './app';
import { logger } from './utils/logger';
import prisma from './plugins/db';
import { getJwtSecret } from './middlewares/auth.middleware';
import { getEncryptionKey } from './utils/crypto';

const PORT = parseInt(process.env.PORT || '8000', 10);

const start = async () => {
  try {
    // Fail-fast security validation on startup
    getJwtSecret();
    logger.info('Authentication configuration validated: JWT_SECRET is loaded.');

    if (!process.env.DATABASE_URL) {
      throw new Error('FATAL SECURITY CONFIGURATION: DATABASE_URL environment variable is missing.');
    }

    if (process.env.INTEGRATION_ENCRYPTION_KEY) {
      getEncryptionKey();
      logger.info('Integration encryption configuration validated: INTEGRATION_ENCRYPTION_KEY is valid.');
    }
  } catch (err: any) {
    logger.error(err.message || err);
    process.exit(1);
  }

  const app = buildApp();

  try {
    // Test DB connection
    await prisma.$connect();
    logger.info('Connected to MySQL Database via Prisma');

    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`Server listening on http://localhost:${PORT}`);

    // Graceful shutdown handling for container/process orchestrators
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      try {
        await app.close();
        await prisma.$disconnect();
        logger.info('Graceful shutdown completed successfully.');
        process.exit(0);
      } catch (err: any) {
        logger.error(err, 'Error during graceful shutdown');
        process.exit(1);
      }

    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();

