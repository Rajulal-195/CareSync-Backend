import { asyncHandler } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';
import * as schedule from '../services/schedule.service';

const doctorId = (req: any) => req.params.doctorId as string;

/** Doctors may read only their own schedule (404 otherwise); admins/receptionists may read any. */
export const get = asyncHandler(async (req, res) => {
  if (req.user!.role === 'DOCTOR' && doctorId(req) !== req.user!.doctorId) throw Errors.notFound('Schedule not found for this doctor');
  res.json({ data: await schedule.getSchedule(doctorId(req)) });
});
export const put = asyncHandler(async (req, res) => { res.json({ message: 'Schedule saved', data: await schedule.upsertSchedule(req.user!, doctorId(req), req.body) }); });
export const patch = asyncHandler(async (req, res) => { res.json({ message: 'Schedule updated', data: await schedule.patchSchedule(req.user!, doctorId(req), req.body) }); });
