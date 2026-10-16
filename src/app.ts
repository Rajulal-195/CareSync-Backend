import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { RequestHandler } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { corsOrigins, env } from './config/env';
import { pingDb } from './config/db';
import { openApiSpec } from './config/openapi';
import { envelope } from './middlewares/envelope';
import { errorHandler, notFoundHandler } from './middlewares/error';
import { apiLimiter } from './middlewares/rateLimit';
import { requestContext } from './middlewares/requestContext';
import { noSqlGuard, originGuard } from './middlewares/security';
import routes from './routes';
import { AppError } from './utils/errors';

const health: RequestHandler = async (_req, res, next) => {
  if (!(await pingDb())) return next(new AppError(503, 'SERVICE_UNAVAILABLE', 'Service unavailable'));
  res.json({ data: { status: 'ok', db: 'up', uptimeSec: Math.round(process.uptime()) } });
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestContext);

  // Swagger UI needs inline scripts/styles: a relaxed CSP applies to the docs only.
  const docsCsp = helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } } });
  app.use('/api/docs', docsCsp, swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api/docs.json', docsCsp, (_req, res) => res.json(openApiSpec));

  // Strict defaults (CSP, HSTS, nosniff, frameguard, referrer-policy...) for the API itself.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(originGuard);
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  }));
  app.use(compression()); // gzip JSON responses (lists can be 100 rows)
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api/v1', envelope);
  app.get('/api/v1/health', health); // unauthenticated + not rate limited, for load balancers / orchestrators
  app.use('/api/v1', apiLimiter, noSqlGuard, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
