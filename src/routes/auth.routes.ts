import { Router } from 'express';
import * as c from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth';
import { csrfProtection } from '../middlewares/csrf';
import { loginLimiter, refreshLimiter } from '../middlewares/rateLimit';
import { validate } from '../middlewares/validate';
import { loginBody } from '../validators/auth.validators';

const r = Router();
r.post('/login', loginLimiter, validate({ body: loginBody }), c.login);
r.post('/refresh', refreshLimiter, csrfProtection, c.refresh);
r.post('/logout', csrfProtection, c.logout);
r.get('/me', authenticate, c.me);
r.get('/csrf', c.csrf);
export default r;
