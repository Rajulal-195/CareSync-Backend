import { Router } from 'express';
import * as c from '../controllers/patient.controller';
import { requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { idParam } from '../validators/common';
import * as v from '../validators/patient.validators';

const r = Router();
r.get('/', requireRole('SUPER_ADMIN', 'RECEPTIONIST'), validate({ query: v.searchPatientsQuery }), c.search);
r.post('/', requireRole('RECEPTIONIST'), validate({ body: v.createPatientBody }), c.register);
// DOCTOR allowed here; the service enforces "only patients with one of my appointments".
r.get('/:id', requireRole('SUPER_ADMIN', 'RECEPTIONIST', 'DOCTOR'), validate({ params: idParam }), c.get);
r.put('/:id', requireRole('RECEPTIONIST'), validate({ params: idParam, body: v.updatePatientBody }), c.update);
r.patch('/:id', requireRole('RECEPTIONIST'), validate({ params: idParam, body: v.updatePatientBody }), c.update);
export default r;
