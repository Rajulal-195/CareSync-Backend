import { FilterQuery } from 'mongoose';
import { Appointment } from '../models/Appointment';
import { ACTIVE_APPOINTMENT_STATUSES } from '../models/constants';
import { Department } from '../models/Department';
import { Doctor, IDoctor } from '../models/Doctor';
import { DoctorSchedule } from '../models/DoctorSchedule';
import { Errors } from '../utils/errors';
import { generateSlots, nowInTimezone } from '../utils/time';

/**
 * Slots are computed on demand from the ACTIVE schedule and the current appointments; nothing is pre-stored.
 * Rules: working day, sessions, breaks, slot duration; "past" is judged in the doctor's schedule timezone
 * (past dates -> no slots, today -> only slots that start after the current local time).
 * Each returned slot is AVAILABLE or BOOKED (an active appointment overlaps it).
 */
export async function listSlots(q: { date: string; doctorId?: string; departmentId?: string }) {
  if (q.departmentId && !(await Department.exists({ _id: q.departmentId }))) throw Errors.notFound('Department not found');
  const filter: FilterQuery<IDoctor> = { isActive: true };
  if (q.doctorId) filter._id = q.doctorId as any;
  if (q.departmentId) filter.department = q.departmentId as any;

  const doctors = await Doctor.find(filter).populate('user', 'name isActive').limit(200);
  if (q.doctorId && doctors.length === 0) throw Errors.notFound('Doctor not found or inactive');
  const ids = doctors.map((d) => d._id);

  const [schedules, booked] = await Promise.all([
    DoctorSchedule.find({ doctor: { $in: ids }, isActive: true }),
    Appointment.find({ doctor: { $in: ids }, appointmentDate: q.date, status: { $in: ACTIVE_APPOINTMENT_STATUSES } }).select('doctor startTime endTime'),
  ]);
  const scheduleOf = new Map<string, (typeof schedules)[number]>();
  for (const s of schedules) scheduleOf.set(String(s.doctor), s);
  const bookedOf = new Map<string, { startTime: string; endTime: string }[]>();
  for (const b of booked) bookedOf.set(String(b.doctor), [...(bookedOf.get(String(b.doctor)) ?? []), b]);

  const out: Record<string, unknown>[] = [];
  for (const d of doctors) {
    const user: any = d.user;
    const schedule = scheduleOf.get(String(d._id));
    if (!user?.isActive || !schedule) continue; // unavailable doctors/schedules produce no slots
    const now = nowInTimezone(schedule.timezone);
    const taken = bookedOf.get(String(d._id)) ?? [];
    const slots =
      q.date < now.date
        ? []
        : generateSlots(schedule, q.date)
            .filter((s) => q.date > now.date || s.startTime > now.time)
            .map((s) => {
              const isBooked = taken.some((b) => b.startTime < s.endTime && b.endTime > s.startTime);
              return { ...s, status: isBooked ? ('BOOKED' as const) : ('AVAILABLE' as const), available: !isBooked };
            });
    out.push({
      doctorId: String(d._id), doctorName: user.name as string, departmentId: String(d.department), specialization: d.specialization,
      date: q.date, timezone: schedule.timezone, slotDuration: schedule.slotDuration, slots,
    });
  }
  return out;
}

export async function doctorSlots(doctorId: string, date: string) {
  const [r] = await listSlots({ doctorId, date });
  if (!r) throw Errors.notFound('Doctor has no active schedule');
  return r;
}

/** Fresh availability for one doctor/day; returned after a booking so the UI can refresh without guessing. */
export async function availabilityFor(doctorId: string, date: string) {
  const [r] = await listSlots({ doctorId, date });
  return r ?? null;
}
