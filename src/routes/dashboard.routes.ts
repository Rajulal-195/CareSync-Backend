import { Router } from 'express';
import * as c from '../controllers/dashboard.controller';
import { requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { dashboardQuery } from '../validators/appointment.validators';

const r = Router();
r.get('/stats', validate({ query: dashboardQuery }), c.stats); // any authenticated role; response depends on role
r.get('/admin', requireRole('SUPER_ADMIN'), validate({ query: dashboardQuery }), c.admin);
r.get('/receptionist', requireRole('RECEPTIONIST'), validate({ query: dashboardQuery }), c.receptionist);
r.get('/doctor', requireRole('DOCTOR'), validate({ query: dashboardQuery }), c.doctor);
export default r;
