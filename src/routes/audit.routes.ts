import { Router } from 'express';
import * as c from '../controllers/audit.controller';
import { requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { auditQuery } from '../validators/audit.validators';

const r = Router();
r.get('/', requireRole('SUPER_ADMIN'), validate({ query: auditQuery }), c.list);
export default r;
