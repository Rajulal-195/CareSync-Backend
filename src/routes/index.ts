import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { Errors } from '../utils/errors';
import { departments, doctors, receptionists } from './admin.routes';
import appointments from './appointment.routes';
import auth from './auth.routes';
import dashboard from './dashboard.routes';
import patients from './patient.routes';
import schedules from './schedule.routes';
import audit from './audit.routes';
import slots from './slot.routes';

const api = Router();
api.use('/auth', auth);                       // public + cookie-based endpoints (own protections)
api.use('/auth', (req, _res, next) => next(Errors.notFound(`Route ${req.method} /auth${req.path} not found`))); // e.g. there is no public registration
api.use(authenticate);                        // everything below requires a valid access token
api.use('/departments', departments);
api.use('/doctors', doctors);
api.use('/receptionists', receptionists);
api.use('/patients', patients);
api.use('/schedules', schedules);
api.use('/slots', slots);
api.use('/audit-logs', audit);
api.use('/appointments', appointments);
api.use('/dashboard', dashboard);
export default api;
