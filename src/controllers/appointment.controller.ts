import { asyncHandler } from '../utils/asyncHandler';
import * as svc from '../services/appointment.service';

export const create = asyncHandler(async (req, res) => {
  const r = await svc.createAppointment(req.user!, req.body);
  res.status(201).json({ message: 'Appointment booked', data: r.appointment, meta: { availability: r.availability } }); // availability = refreshed slots for that doctor/day
});
export const list = asyncHandler(async (req, res) => { res.json(await svc.listAppointments(req.user!, req.query)); });
export const get = asyncHandler(async (req, res) => { res.json({ data: await svc.getAppointment(req.user!, req.params.id) }); });
export const update = asyncHandler(async (req, res) => { res.json({ data: await svc.updateAppointment(req.user!, req.params.id, req.body) }); });
export const cancel = asyncHandler(async (req, res) => { res.json({ data: await svc.cancelAppointment(req.user!, req.params.id, req.body.reason) }); });
export const arrive = asyncHandler(async (req, res) => { res.json({ data: await svc.markArrived(req.user!, req.params.id) }); });
export const consultation = asyncHandler(async (req, res) => { res.json({ data: await svc.updateConsultation(req.user!, req.params.id, req.body) }); });
export const complete = asyncHandler(async (req, res) => { res.json({ data: await svc.completeAppointment(req.user!, req.params.id, req.body) }); });
// DELETE is a logical cancel; the record is preserved.
export const remove = asyncHandler(async (req, res) => { res.json({ message: 'Appointment cancelled', data: await svc.cancelAppointment(req.user!, req.params.id, (req.query as any).reason, 'delete') }); });
