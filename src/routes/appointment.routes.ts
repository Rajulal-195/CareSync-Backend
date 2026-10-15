import { Router } from 'express';
import * as c from '../controllers/appointment.controller';
import { requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as v from '../validators/appointment.validators';
import { idParam } from '../validators/common';

const ALL = requireRole('SUPER_ADMIN', 'RECEPTIONIST', 'DOCTOR');
const REC = requireRole('RECEPTIONIST');
const r = Router();
r.get('/', ALL, validate({ query: v.listAppointmentsQuery }), c.list);
r.post('/', REC, validate({ body: v.createAppointmentBody }), c.create);
r.get('/:id', ALL, validate({ params: idParam }), c.get);
r.put('/:id', REC, validate({ params: idParam, body: v.updateAppointmentBody }), c.update); // same partial-update body as PATCH
r.patch('/:id', REC, validate({ params: idParam, body: v.updateAppointmentBody }), c.update);
r.delete('/:id', REC, validate({ params: idParam, query: v.deleteAppointmentQuery }), c.remove); // logical cancel, never a physical delete
r.post('/:id/cancel', REC, validate({ params: idParam, body: v.cancelAppointmentBody }), c.cancel);
r.post('/:id/arrive', REC, validate({ params: idParam }), c.arrive);
r.post('/:id/complete', requireRole('DOCTOR', 'RECEPTIONIST'), validate({ params: idParam, body: v.completeBody }), c.complete);
r.patch('/:id/consultation', requireRole('DOCTOR'), validate({ params: idParam, body: v.consultationBody }), c.consultation);
export default r;
