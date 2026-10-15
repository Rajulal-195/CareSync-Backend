import { FilterQuery } from 'mongoose';
import { Appointment } from '../models/Appointment';
import { Counter } from '../models/Counter';
import { IPatient, Patient } from '../models/Patient';
import { Errors } from '../utils/errors';
import { escapeRegex, pageMeta, skipOf } from '../utils/pagination';
import { audit } from './audit.service';

export async function nextPatientId() {
  const c = await Counter.findOneAndUpdate({ _id: 'patientId' }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `PT-${String(c.seq).padStart(6, '0')}`; // atomic $inc => no duplicates under concurrency
}

export async function registerPatient(actor: Express.AuthUser, input: any) {
  const p = await Patient.create({ ...input, patientId: await nextPatientId() });
  await audit({ userId: actor.id, role: actor.role, action: 'PATIENT_REGISTERED', entity: 'Patient', entityId: p._id });
  return p;
}

/**
 * Builds the Patient filter for free-text/field search (used by /patients and by appointment search).
 * patientId: anchored, upper-cased prefix (uses the unique index). mobile / name: literal (regex-escaped) contains.
 * Contains-searches cannot use a B-tree index; at larger scale move name search to a text / Atlas Search index.
 */
export function patientSearchFilter(q: { q?: string; patientCode?: string; mobile?: string; patientName?: string }): FilterQuery<IPatient> | undefined {
  const and: FilterQuery<IPatient>[] = [];
  if (q.q) {
    const t = q.q.trim();
    and.push({ $or: [{ patientId: new RegExp(`^${escapeRegex(t.toUpperCase())}`) }, { mobile: new RegExp(escapeRegex(t)) }, { name: new RegExp(escapeRegex(t), 'i') }] });
  }
  if (q.patientCode) and.push({ patientId: q.patientCode.trim().toUpperCase() });
  if (q.mobile) and.push({ mobile: new RegExp(escapeRegex(q.mobile.trim())) });
  if (q.patientName) and.push({ name: new RegExp(escapeRegex(q.patientName.trim()), 'i') });
  return and.length ? { $and: and } : undefined;
}

export async function searchPatients(q: { page: number; limit: number; q?: string; sortBy: 'createdAt' | 'name' | 'patientId'; sortOrder: 'asc' | 'desc' }) {
  const filter = patientSearchFilter(q) ?? {};
  const dir = q.sortOrder === 'asc' ? 1 : -1;
  const [data, total] = await Promise.all([
    Patient.find(filter).select('-__v').sort({ [q.sortBy]: dir, _id: dir }).skip(skipOf(q)).limit(q.limit).lean(),
    Patient.countDocuments(filter),
  ]);
  return { data, meta: pageMeta(q, total, { sortBy: q.sortBy, sortOrder: q.sortOrder }) };
}

/** Record-level rule: a doctor may read a patient only if they have an appointment with that patient. */
export async function getPatient(actor: Express.AuthUser, id: string) {
  if (actor.role === 'DOCTOR' && !(await Appointment.exists({ doctor: actor.doctorId, patient: id })))
    throw Errors.notFound('Patient not found');
  const p = await Patient.findById(id);
  if (!p) throw Errors.notFound('Patient not found');
  return p;
}

export async function updatePatient(actor: Express.AuthUser, id: string, patch: any) {
  const p = await Patient.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true });
  if (!p) throw Errors.notFound('Patient not found');
  await audit({ userId: actor.id, role: actor.role, action: 'PATIENT_UPDATED', entity: 'Patient', entityId: p._id, metadata: { fields: Object.keys(patch) } });
  return p;
}
