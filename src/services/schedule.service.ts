import { Appointment } from '../models/Appointment';
import { Doctor } from '../models/Doctor';
import { DoctorSchedule, ISchedule } from '../models/DoctorSchedule';
import { scheduleBody } from '../validators/admin.validators';
import { AppError, Errors } from '../utils/errors';
import { generateSlots, nowInTimezone } from '../utils/time';
import { audit } from './audit.service';

type ScheduleInput = Pick<ISchedule, 'timezone' | 'workingDays' | 'sessions' | 'slotDuration' | 'breaks' | 'isActive'>;

/**
 * A schedule edit must not silently orphan bookings. Every upcoming SCHEDULED/ARRIVED appointment
 * (judged at "now" in the schedule's CURRENT timezone) must still sit exactly on a slot of the new schedule,
 * the schedule must stay active, and the timezone must not change (stored date/time strings are wall-clock
 * values in that timezone, so changing it would silently move the real-world instant of every booking).
 * Otherwise the edit is rejected with 409 SCHEDULE_CONFLICT listing the affected appointments; the admin must
 * reschedule or cancel those first. COMPLETED / CANCELLED / already-elapsed appointments never block edits.
 */
async function assertNoConflicts(doctorId: string, old: ISchedule, next: ScheduleInput) {
  const now = nowInTimezone(old.timezone);
  const upcoming = (
    await Appointment.find({ doctor: doctorId, status: { $in: ['SCHEDULED', 'ARRIVED'] }, appointmentDate: { $gte: now.date } })
      .select('appointmentDate startTime endTime status')
      .sort({ appointmentDate: 1, startTime: 1 })
  ).filter((a) => a.appointmentDate > now.date || a.endTime > now.time);
  if (!upcoming.length) return;

  const tzChanged = next.timezone !== old.timezone;
  const conflicts = upcoming
    .map((a) => {
      let reason: string | null = null;
      if (tzChanged) reason = 'timezone change';
      else if (!next.isActive) reason = 'schedule deactivated';
      else if (!generateSlots(next, a.appointmentDate).some((s) => s.startTime === a.startTime && s.endTime === a.endTime)) reason = 'no longer matches a generated slot';
      return reason ? { id: String(a._id), appointmentDate: a.appointmentDate, startTime: a.startTime, endTime: a.endTime, status: a.status, reason } : null;
    })
    .filter(Boolean);
  if (conflicts.length)
    throw new AppError(409, 'SCHEDULE_CONFLICT', `Schedule change would invalidate ${conflicts.length} upcoming appointment(s). Reschedule or cancel them first.`, {
      count: conflicts.length, appointments: conflicts.slice(0, 50),
    });
}

export async function upsertSchedule(actor: Express.AuthUser, doctorId: string, input: ScheduleInput) {
  if (!(await Doctor.exists({ _id: doctorId }))) throw Errors.notFound('Doctor not found');
  const old = await DoctorSchedule.findOne({ doctor: doctorId });
  if (old) await assertNoConflicts(doctorId, old, input);
  const s = await DoctorSchedule.findOneAndUpdate(
    { doctor: doctorId },
    { $set: input, $setOnInsert: { doctor: doctorId } },
    { new: true, upsert: true, runValidators: true },
  );
  await audit({
    userId: actor.id, role: actor.role, action: old ? 'SCHEDULE_UPDATED' : 'SCHEDULE_CREATED', entity: 'DoctorSchedule', entityId: s._id,
    metadata: { doctorId, timezone: input.timezone, isActive: input.isActive, slotDuration: input.slotDuration },
  });
  return s;
}

/** PATCH: merge onto the stored schedule, re-run full validation, then the same conflict protection as PUT. */
export async function patchSchedule(actor: Express.AuthUser, doctorId: string, patch: Partial<ScheduleInput>) {
  const old = await DoctorSchedule.findOne({ doctor: doctorId });
  if (!old) throw Errors.notFound('Schedule not found for this doctor');
  const merged = scheduleBody.parse({
    timezone: old.timezone, workingDays: [...old.workingDays], slotDuration: old.slotDuration, isActive: old.isActive,
    sessions: old.sessions.map((s) => ({ start: s.start, end: s.end })),
    breaks: old.breaks.map((b) => ({ start: b.start, end: b.end })),
    ...patch,
  });
  return upsertSchedule(actor, doctorId, merged);
}

export async function getSchedule(doctorId: string) {
  const s = await DoctorSchedule.findOne({ doctor: doctorId });
  if (!s) throw Errors.notFound('Schedule not found for this doctor');
  return s;
}
