import { Router } from 'express';
import * as c from '../controllers/schedule.controller';
import { requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { schedulePatchBody, scheduleBody } from '../validators/admin.validators';
import { objectId } from '../validators/common';
import { z } from 'zod';

const params = z.object({ doctorId: objectId });
const r = Router();
r.get('/:doctorId', requireRole('SUPER_ADMIN', 'RECEPTIONIST', 'DOCTOR'), validate({ params }), c.get);
r.put('/:doctorId', requireRole('SUPER_ADMIN'), validate({ params, body: scheduleBody }), c.put);
r.patch('/:doctorId', requireRole('SUPER_ADMIN'), validate({ params, body: schedulePatchBody }), c.patch);
export default r;
