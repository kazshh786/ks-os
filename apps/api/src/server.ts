import { buildApp } from './app.js';
import { env } from './config/env.js';

const server = buildApp();

const start = async () => {
  try {
    const port = env.PORT;
    const host = '127.0.0.1';
    
    await server.listen({ port, host });
    server.log.info(`Server listening on port ${port} in ${env.NODE_ENV} mode`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown hooks
const closeGracefully = async (signal: string) => {
  server.log.info(`Received ${signal}. Shutting down Fastify server...`);
  await server.close();
  server.log.info('Fastify server shutdown complete. Exiting.');
  process.exit(0);
};

process.on('SIGTERM', () => closeGracefully('SIGTERM'));
process.on('SIGINT', () => closeGracefully('SIGINT'));

start();
