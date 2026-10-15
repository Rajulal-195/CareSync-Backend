import { Router } from 'express';
import * as c from '../controllers/slot.controller';
import { requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { slotsListQuery } from '../validators/appointment.validators';

const r = Router();
// GET /api/v1/slots?date=YYYY-MM-DD[&doctorId=][&departmentId=]
r.get('/', requireRole('SUPER_ADMIN', 'RECEPTIONIST'), validate({ query: slotsListQuery }), c.list);
export default r;
