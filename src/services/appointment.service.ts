import mongoose, { FilterQuery } from 'mongoose';
import { emitAppointmentEvent, emitSlotUpdated, AppointmentEvent } from '../sockets/realtime';
import { Appointment, IAppointment } from '../models/Appointment';
import { ACTIVE_APPOINTMENT_STATUSES, ALLOWED_TRANSITIONS, APPOINTMENT_STATUSES, AppointmentStatus } from '../models/constants';
import { Doctor } from '../models/Doctor';
import { DoctorSchedule } from '../models/DoctorSchedule';
import { Patient } from '../models/Patient';
import { User } from '../models/User';
import { AppError, Errors, isDuplicateKey } from '../utils/errors';
import { pageMeta, skipOf } from '../utils/pagination';
import { generateSlots, nowInTimezone } from '../utils/time';
import { audit } from './audit.service';
import { nextPatientId, patientSearchFilter } from './patient.service';
import { availabilityFor } from './slot.service';

const POPULATE: any[] = [
  { path: 'patient', select: 'patientId name mobile gender dateOfBirth' },
  { path: 'doctor', select: 'user specialization room', populate: { path: 'user', select: 'name' } },
  { path: 'department', select: 'name' },
];

const slotTaken = (e: unknown) => (isDuplicateKey(e) ? Errors.conflict('This slot is already booked') : e);
const noTransactions = (e: any) => e?.code === 20 || /replica set|Transaction numbers are only allowed/i.test(e?.message ?? '');

const brief = (a: any) => ({ id: String(a._id), doctor: String(a.doctor), status: a.status, appointmentDate: a.appointmentDate, startTime: a.startTime });
// Realtime hints are emitted strictly AFTER the write has succeeded.
const publish = (event: AppointmentEvent, a: any, opts: { previousStatus?: string; extraDoctorIds?: string[] } = {}) => emitAppointmentEvent(event, brief(a), opts);
const publishSlot = (doctorId: unknown, date: string) => emitSlotUpdated(String(doctorId), date);

/**
 * Validates doctor/schedule/slot/past/overlap. The partial unique index remains the final arbiter under concurrency.
 * Queries are batched into two parallel rounds (was five sequential round trips); results are still interpreted in
 * the original order, so the error a caller gets for a given situation is unchanged.
 */
async function assertBookable(a: { doctorId: string; date: string; startTime: string; excludeId?: string }) {
  const [doctor, schedule] = await Promise.all([
    Doctor.findById(a.doctorId).lean(),
    DoctorSchedule.findOne({ doctor: a.doctorId, isActive: true }).lean(),
  ]);
  if (!doctor) throw Errors.notFound('Doctor not found');
  const slot = schedule ? generateSlots(schedule, a.date).find((s) => s.startTime === a.startTime) : undefined;
  const [owner, clash] = await Promise.all([
    User.findById(doctor.user).select('isActive').lean(),
    slot
      ? Appointment.exists({
          doctor: doctor._id, appointmentDate: a.date, status: { $in: ACTIVE_APPOINTMENT_STATUSES },
          startTime: { $lt: slot.endTime }, endTime: { $gt: slot.startTime },
          ...(a.excludeId ? { _id: { $ne: a.excludeId } } : {}),
        })
      : Promise.resolve(null),
  ]);
  if (!doctor.isActive || !owner?.isActive) throw Errors.conflict('Doctor is not active');
  if (!schedule) throw Errors.conflict('Doctor has no active schedule');
  if (!slot) throw Errors.unprocessable('Requested time is not a bookable slot for this doctor and date');
  const now = nowInTimezone(schedule.timezone);
  if (a.date < now.date || (a.date === now.date && a.startTime <= now.time)) throw Errors.unprocessable('Cannot book a slot in the past');
  if (clash) throw Errors.conflict('This slot is already booked');
  return { doctor, slot };
}

const buildDoc = (actor: Express.AuthUser, i: any, doctor: any, slot: { startTime: string; endTime: string }, patient: unknown): any => ({
  patient, doctor: doctor._id, department: doctor.department, appointmentDate: i.appointmentDate,
  startTime: slot.startTime, endTime: slot.endTime, purpose: i.purpose, notes: i.notes, createdBy: actor.id,
});

/**
 * New patient + appointment must succeed or fail together. Uses a MongoDB transaction (replica set / Atlas).
 * If the deployment is a standalone mongod (dev only) transactions are unavailable, so we fall back to
 * compensation: create the patient, and delete it again if the appointment insert fails.
 * A duplicate-key error on the slot index aborts the transaction => no orphan patient, HTTP 409.
 * The patient code is allocated before the transaction (atomic counter), so a rollback can leave a gap in codes.
 */
async function createWithNewPatient(actor: Express.AuthUser, i: any, doctor: any, slot: { startTime: string; endTime: string }) {
  const patientCode = await nextPatientId();
  const session = await mongoose.startSession();
  try {
    let created: any;
    await session.withTransaction(async () => {
      const [patient] = await Patient.create([{ ...i.newPatient, patientId: patientCode }], { session });
      [created] = await Appointment.create([buildDoc(actor, i, doctor, slot, patient._id)], { session });
    });
    return created;
  } catch (e) {
    if (!noTransactions(e)) throw slotTaken(e);
    const patient = await Patient.create({ ...i.newPatient, patientId: patientCode });
    try {
      return await Appointment.create(buildDoc(actor, i, doctor, slot, patient._id));
    } catch (e2) {
      await Patient.deleteOne({ _id: patient._id });
      throw slotTaken(e2);
    }
  } finally {
    await session.endSession();
  }
}

export async function createAppointment(actor: Express.AuthUser, i: any) {
  // Patient check and bookability run in parallel; results are interpreted in the original order (patient first).
  const patientCheck = i.patientId ? Patient.exists({ _id: i.patientId }) : Promise.resolve(true);
  const bookable = assertBookable({ doctorId: i.doctorId, date: i.appointmentDate, startTime: i.startTime });
  bookable.catch(() => undefined); // avoid an unhandled rejection if the patient check throws first
  if (!(await patientCheck)) throw Errors.notFound('Patient not found');
  const { doctor, slot } = await bookable;

  let appt: any;
  const audits: Promise<unknown>[] = [];
  if (i.patientId) {
    try { appt = await Appointment.create(buildDoc(actor, i, doctor, slot, i.patientId)); } catch (e) { throw slotTaken(e); }
  } else {
    appt = await createWithNewPatient(actor, i, doctor, slot);
    audits.push(audit({ userId: actor.id, role: actor.role, action: 'PATIENT_REGISTERED', entity: 'Patient', entityId: appt.patient, metadata: { via: 'booking' } }));
  }
  audits.push(audit({ userId: actor.id, role: actor.role, action: 'APPOINTMENT_CREATED', entity: 'Appointment', entityId: appt._id, metadata: { doctorId: i.doctorId, date: i.appointmentDate, startTime: slot.startTime } }));
  publish('created', appt); // after persistence (and after transaction commit)
  publishSlot(appt.doctor, appt.appointmentDate);
  // Audit writes (still awaited before responding) overlap with the read-back instead of preceding it.
  const [appointment, availability] = await Promise.all([
    getAppointment(actor, String(appt._id)),
    availabilityFor(String(doctor._id), i.appointmentDate),
    Promise.all(audits),
  ]);
  return { appointment, availability };
}

const scopeFor = (actor: Express.AuthUser): FilterQuery<IAppointment> =>
  actor.role === 'DOCTOR' ? { doctor: actor.doctorId } : {}; // record-level authorization: doctors are pinned to themselves

/** 404 (not 403) for records outside the caller's scope so ids can't be probed. */
export async function getAppointment(actor: Express.AuthUser, id: string) {
  const a = await Appointment.findOne({ _id: id, ...scopeFor(actor) }).select('-__v').populate(POPULATE).lean();
  if (!a) throw Errors.notFound('Appointment not found');
  return a;
}

// Lean, minimal projections for lists: no clinical notes, no patient PII beyond what a worklist needs.
const LIST_POPULATE: any[] = [
  { path: 'patient', select: 'patientId name mobile' },
  { path: 'doctor', select: 'user specialization', populate: { path: 'user', select: 'name' } },
  { path: 'department', select: 'name' },
];
const MAX_PATIENT_MATCHES = 2000;

/**
 * Server-side search / filter / sort / pagination.
 * - Record-level scope is applied first (a DOCTOR is always pinned to their own appointments).
 * - Patient text filters (q, patientName, patientCode, mobile) are resolved to patient _ids, then matched on the
 *   indexed `patient` field, so appointment queries stay index-friendly.
 * - Sorting uses an allow-list (validated by Zod) plus `_id` as a stable tie-breaker so pages never overlap.
 */
export async function listAppointments(actor: Express.AuthUser, q: any) {
  const conds: FilterQuery<IAppointment>[] = [scopeFor(actor)];
  if (actor.role !== 'DOCTOR' && q.doctorId) conds.push({ doctor: q.doctorId }); // a doctor's doctorId filter is ignored
  if (q.patientId) conds.push({ patient: q.patientId });
  if (q.departmentId) conds.push({ department: q.departmentId });
  if (q.status?.length) conds.push({ status: { $in: q.status } });
  if (q.date) conds.push({ appointmentDate: q.date });
  else if (q.dateFrom || q.dateTo) conds.push({ appointmentDate: { ...(q.dateFrom ? { $gte: q.dateFrom } : {}), ...(q.dateTo ? { $lte: q.dateTo } : {}) } });

  const patientFilter = patientSearchFilter(q);
  if (patientFilter) {
    const hits = await Patient.find(patientFilter).select('_id').limit(MAX_PATIENT_MATCHES + 1).lean();
    if (hits.length > MAX_PATIENT_MATCHES) throw Errors.badRequest('Search is too broad, please refine it');
    conds.push({ patient: { $in: hits.map((p) => p._id) } });
  }
  const filter: FilterQuery<IAppointment> = { $and: conds };

  const dir = q.sortOrder === 'desc' ? -1 : 1;
  const sort: Record<string, 1 | -1> = { [q.sortBy]: dir };
  if (q.sortBy === 'appointmentDate') sort.startTime = dir;
  if (q.sortBy === 'startTime') sort.appointmentDate = dir;
  sort._id = dir;

  const [data, total] = await Promise.all([
    Appointment.find(filter).select('-consultationNotes -__v').populate(LIST_POPULATE).sort(sort).skip(skipOf(q)).limit(q.limit).lean(),
    Appointment.countDocuments(filter),
  ]);
  return { data, meta: pageMeta(q, total, { sortBy: q.sortBy, sortOrder: q.sortOrder }) };
}

/** purpose/notes: editable while SCHEDULED or ARRIVED. doctor/date/time (reschedule): SCHEDULED only. */
export async function updateAppointment(actor: Express.AuthUser, id: string, i: any) {
  const appt = await Appointment.findById(id);
  if (!appt) throw Errors.notFound('Appointment not found');
  if (!['SCHEDULED', 'ARRIVED'].includes(appt.status)) throw Errors.conflict('Only SCHEDULED or ARRIVED appointments can be edited');
  const prevDoctor = String(appt.doctor);
  const prevDate = appt.appointmentDate;
  const prevStart = appt.startTime;
  const doctorId = i.doctorId ?? prevDoctor;
  const date = i.appointmentDate ?? appt.appointmentDate;
  const startTime = i.startTime ?? appt.startTime;
  if (doctorId !== prevDoctor || date !== appt.appointmentDate || startTime !== appt.startTime) {
    if (appt.status !== 'SCHEDULED') throw Errors.conflict('Only SCHEDULED appointments can be rescheduled');
    const { doctor, slot } = await assertBookable({ doctorId, date, startTime, excludeId: id });
    appt.doctor = doctor._id; appt.department = doctor.department;
    appt.appointmentDate = date; appt.startTime = slot.startTime; appt.endTime = slot.endTime;
  }
  if (i.purpose !== undefined) appt.purpose = i.purpose;
  if (i.notes !== undefined) appt.notes = i.notes;
  try { await appt.save(); } catch (e) { throw slotTaken(e); }
  await audit({ userId: actor.id, role: actor.role, action: 'APPOINTMENT_UPDATED', entity: 'Appointment', entityId: appt._id, metadata: { fields: Object.keys(i) } });
  publish('updated', appt, { extraDoctorIds: prevDoctor !== String(appt.doctor) ? [prevDoctor] : [] });
  if (prevDoctor !== String(appt.doctor) || prevDate !== appt.appointmentDate || prevStart !== appt.startTime) {
    publishSlot(prevDoctor, prevDate); // old slot freed
    publishSlot(appt.doctor, appt.appointmentDate); // new slot taken
  }
  return getAppointment(actor, id);
}

/** Atomic compare-and-set; the allowed source statuses are derived from ALLOWED_TRANSITIONS. */
async function transition(id: string, to: AppointmentStatus, set: Partial<IAppointment> = {}) {
  const from = APPOINTMENT_STATUSES.filter((s) => ALLOWED_TRANSITIONS[s].includes(to));
  const updated = await Appointment.findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: { status: to, ...set } }, { new: true });
  if (updated) return updated;
  const cur = await Appointment.findById(id).select('status');
  if (!cur) throw Errors.notFound('Appointment not found');
  throw new AppError(409, 'INVALID_TRANSITION', `Cannot move an appointment from ${cur.status} to ${to}`, { from: cur.status, to, allowedFromCurrent: ALLOWED_TRANSITIONS[cur.status] });
}

/** Logical cancel only: the record is kept (status CANCELLED + who/when/why) for auditability. Also used by DELETE. */
export async function cancelAppointment(actor: Express.AuthUser, id: string, reason?: string, via = 'cancel') {
  const cur = await Appointment.findById(id).select('status');
  if (!cur) throw Errors.notFound('Appointment not found');
  if (cur.status === 'ARRIVED' && !reason) throw Errors.unprocessable('A reason is required to cancel an appointment after the patient has arrived');
  const a = await transition(id, 'CANCELLED', { cancelledAt: new Date(), cancelReason: reason, cancelledBy: actor.id as any });
  await audit({ userId: actor.id, role: actor.role, action: 'APPOINTMENT_CANCELLED', entity: 'Appointment', entityId: a._id, metadata: { via, previousStatus: cur.status, justified: Boolean(reason) } });
  publish('cancelled', a);
  publishSlot(a.doctor, a.appointmentDate);
  return getAppointment(actor, id);
}

export async function markArrived(actor: Express.AuthUser, id: string) {
  const a = await transition(id, 'ARRIVED', { arrivedAt: new Date() });
  await audit({ userId: actor.id, role: actor.role, action: 'APPOINTMENT_ARRIVED', entity: 'Appointment', entityId: a._id, metadata: { from: 'SCHEDULED', to: 'ARRIVED' } });
  publish('status-changed', a, { previousStatus: 'SCHEDULED' });
  return getAppointment(actor, id);
}

/** ARRIVED -> COMPLETED. Assigned doctor (may add notes) or receptionist (no notes). */
export async function completeAppointment(actor: Express.AuthUser, id: string, input: { consultationNotes?: string }) {
  if (actor.role === 'DOCTOR') {
    if (!(await Appointment.exists({ _id: id, doctor: actor.doctorId }))) throw Errors.notFound('Appointment not found');
  } else if (input.consultationNotes !== undefined) {
    throw Errors.forbidden('Only the assigned doctor can write consultation notes');
  }
  const set: Partial<IAppointment> = { completedAt: new Date() };
  if (input.consultationNotes !== undefined) set.consultationNotes = input.consultationNotes;
  const a = await transition(id, 'COMPLETED', set);
  await audit({ userId: actor.id, role: actor.role, action: 'APPOINTMENT_COMPLETED', entity: 'Appointment', entityId: a._id, metadata: { from: 'ARRIVED', to: 'COMPLETED' } });
  publish('status-changed', a, { previousStatus: 'ARRIVED' });
  return getAppointment(actor, id);
}

export async function updateConsultation(actor: Express.AuthUser, id: string, i: { consultationNotes?: string; complete?: boolean }) {
  const appt = await Appointment.findOne({ _id: id, doctor: actor.doctorId });
  if (!appt) throw Errors.notFound('Appointment not found');
  if (!['ARRIVED', 'COMPLETED'].includes(appt.status)) throw Errors.conflict('Consultation notes require the patient to have arrived');
  if (i.complete && appt.status === 'ARRIVED') return completeAppointment(actor, id, { consultationNotes: i.consultationNotes });
  const updated = await Appointment.findOneAndUpdate({ _id: id, doctor: actor.doctorId, status: appt.status }, { $set: { consultationNotes: i.consultationNotes } }, { new: true });
  if (!updated) throw Errors.conflict('Appointment changed concurrently, retry');
  await audit({ userId: actor.id, role: actor.role, action: 'CONSULTATION_NOTES_UPDATED', entity: 'Appointment', entityId: updated._id });
  return getAppointment(actor, id);
}
