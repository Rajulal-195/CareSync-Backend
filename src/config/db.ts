import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let listening = false;

/** Connects with bounded retries + backoff; throws after the last attempt so the process can exit cleanly. */
export async function connectDb(uri = env.MONGODB_URI) {
  mongoose.set('strictQuery', true);
  if (!listening) {
    listening = true;
    mongoose.connection.on('error', (e) => logger.error('mongo_error', e));
    mongoose.connection.on('disconnected', () => logger.warn('mongo_disconnected'));
    mongoose.connection.on('reconnected', () => logger.info('mongo_reconnected'));
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20, minPoolSize: 5 });
      break;
    } catch (e) {
      logger.error('mongo_connect_failed', { attempt, of: env.DB_CONNECT_RETRIES, error: e });
      if (attempt >= env.DB_CONNECT_RETRIES) throw new Error('Could not connect to MongoDB');
      await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    }
  }
  // Make sure unique / partial indexes exist before we accept traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  logger.info('mongo_connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export async function pingDb() {
  if (mongoose.connection.readyState !== 1) return false;
  try { await mongoose.connection.db!.admin().ping(); return true; } catch { return false; }
}
