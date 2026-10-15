import { Router } from 'express';
import * as c from '../controllers/admin.controller';
import { requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as v from '../validators/admin.validators';
import { idParam } from '../validators/common';
import { slotsQuery } from '../validators/appointment.validators';

// Mounted after `authenticate` in routes/index.ts.
const SA = requireRole('SUPER_ADMIN');
const SA_REC = requireRole('SUPER_ADMIN', 'RECEPTIONIST');

export const departments = Router();
departments.get('/', SA_REC, validate({ query: v.listDepartmentsQuery }), c.listDepartments);
departments.post('/', SA, validate({ body: v.createDepartmentBody }), c.createDepartment);
departments.get('/:id', SA_REC, validate({ params: idParam }), c.getDepartment);
departments.patch('/:id', SA, validate({ params: idParam, body: v.updateDepartmentBody }), c.updateDepartment);
departments.put('/:id', SA, validate({ params: idParam, body: v.updateDepartmentBody }), c.updateDepartment);

export const doctors = Router();
doctors.get('/', SA_REC, validate({ query: v.listDoctorsQuery }), c.listDoctors);
doctors.post('/', SA, validate({ body: v.createDoctorBody }), c.createDoctor);
doctors.get('/:id', SA_REC, validate({ params: idParam }), c.getDoctor);
doctors.patch('/:id', SA, validate({ params: idParam, body: v.updateDoctorBody }), c.updateDoctor);
doctors.put('/:id', SA, validate({ params: idParam, body: v.updateDoctorBody }), c.updateDoctor); // same partial-update body as PATCH
doctors.get('/:id/schedule', SA_REC, validate({ params: idParam }), c.getSchedule);
doctors.patch('/:id/schedule', SA, validate({ params: idParam, body: v.schedulePatchBody }), c.patchSchedule);
doctors.put('/:id/schedule', SA, validate({ params: idParam, body: v.scheduleBody }), c.putSchedule);
doctors.get('/:id/slots', SA_REC, validate({ params: idParam, query: slotsQuery }), c.getSlots);

export const receptionists = Router();
receptionists.use(SA);
receptionists.get('/', validate({ query: v.listReceptionistsQuery }), c.listReceptionists);
receptionists.post('/', validate({ body: v.createReceptionistBody }), c.createReceptionist);
receptionists.get('/:id', validate({ params: idParam }), c.getReceptionist);
receptionists.patch('/:id', validate({ params: idParam, body: v.updateReceptionistBody }), c.updateReceptionist);
receptionists.put('/:id', validate({ params: idParam, body: v.updateReceptionistBody }), c.updateReceptionist);
