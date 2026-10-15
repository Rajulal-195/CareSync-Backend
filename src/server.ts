import http from 'http';
import mongoose from 'mongoose';
import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { initSocket } from './sockets';
import { logger } from './utils/logger';

async function main() {
  await connectDb(); // throws (after retries) if MongoDB is unreachable -> process exits non-zero
  const server = http.createServer(createApp());
  const io = initSocket(server);
  server.keepAliveTimeout = 65_000; // above typical load-balancer idle timeouts
  server.listen(env.PORT, () => logger.info('server_listening', { port: env.PORT }));

  let closing = false;
  const shutdown = (reason: string, code = 0) => {
    if (closing) return;
    closing = true;
    logger.info('shutdown_started', { reason });
    const force = setTimeout(() => { logger.error('shutdown_forced'); process.exit(1); }, env.SHUTDOWN_TIMEOUT_MS);
    force.unref();
    io.close(); // stops websockets
    server.close(async () => { // stops accepting, waits for in-flight requests
      try { await mongoose.disconnect(); } finally { process.exit(code); }
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => { logger.error('unhandled_rejection', e as Error); shutdown('unhandledRejection', 1); });
  process.on('uncaughtException', (e) => { logger.error('uncaught_exception', e); shutdown('uncaughtException', 1); });
}
main().catch((e) => { logger.error('startup_failed', e); process.exit(1); });
