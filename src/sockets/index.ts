import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { corsOrigins } from '../config/env';
import { authenticateAccessToken } from '../services/auth.service';
import { logger } from '../utils/logger';
import { setIO } from './realtime';

export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, { cors: { origin: corsOrigins, credentials: true }, maxHttpBufferSize: 1e4 });

  // Authenticate during the handshake with the same access token used for REST.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      socket.data.user = await authenticateAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const u = socket.data.user as Express.AuthUser;
    // Server decides the rooms from the verified identity; clients cannot join anything themselves.
    socket.join([`user:${u.id}`, `role:${u.role}`]);
    if (u.role === 'DOCTOR' && u.doctorId) socket.join(`doctor:${u.doctorId}`);

    // Reconnect contract: events are not replayed. Every (re)connect tells the client to refresh from REST.
    socket.emit('sync:required', { serverTime: new Date().toISOString() });

    // Access tokens are short-lived: warn, then drop the socket when the token that opened it expires.
    if (u.tokenExp) {
      const t = setTimeout(() => { socket.emit('auth:expired'); socket.disconnect(true); }, Math.max(0, u.tokenExp * 1000 - Date.now()));
      socket.on('disconnect', () => clearTimeout(t));
    }
    socket.on('error', (e) => logger.warn('socket_error', e));
  });

  setIO(io);
  return io;
}
