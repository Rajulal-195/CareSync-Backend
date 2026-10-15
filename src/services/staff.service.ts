import bcrypt from 'bcrypt';
import { FilterQuery, Types } from 'mongoose';
import { env } from '../config/env';
import { Department } from '../models/Department';
import { Appointment } from '../models/Appointment';
import { Doctor, IDoctor } from '../models/Doctor';
import { DoctorSchedule } from '../models/DoctorSchedule';
import { IUser, User } from '../models/User';
import { AppError, Errors, isDuplicateKey } from '../utils/errors';
import { escapeRegex, pageMeta, skipOf } from '../utils/pagination';
import { audit } from './audit.service';
import { revokeAllSessions } from './auth.service';

const hash = (pw: string) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);
const dupEmail = (e: unknown) => (isDuplicateKey(e) ? Errors.conflict('Email already in use') : e);

async function createUser(name: string, email: string, password: string, role: 'DOCTOR' | 'RECEPTIONIST') {
  try {
    return await User.create({ name, email, role, passwordHash: await hash(password) });
  } catch (e) {
    throw dupEmail(e);
  }
}

// ------------------------------------------------------------------ doctors
export async function createDoctor(actor: Express.AuthUser, i: any) {
  const dept = await Department.findById(i.departmentId);
  if (!dept || !dept.isActive) throw Errors.unprocessable('Department not found or inactive');
  const user = await createUser(i.name, i.email, i.password, 'DOCTOR');
  try {
    const doctor = await Doctor.create({
      user: user._id, department: dept._id, specialization: i.specialization, qualification: i.qualification,
      experienceYears: i.experienceYears, consultationFee: i.consultationFee ?? 0, room: i.room,
    });
    await audit({ userId: actor.id, role: actor.role, action: 'DOCTOR_CREATED', entity: 'Doctor', entityId: doctor._id });
    return getDoctor(doctor.id);
  } catch (e) {
    await User.deleteOne({ _id: user._id }); // no transactions on standalone Mongo: compensate
    throw e;
  }
}

const doctorPopulate = [
  { path: 'user', select: 'name email isActive' },
  { path: 'department', select: 'name' },
];

export async function getDoctor(id: string) {
  const d = await Doctor.findById(id).populate(doctorPopulate);
  if (!d) throw Errors.notFound('Doctor not found');
  return d;
}

export async function listDoctors(q: { page: number; limit: number; departmentId?: string; isActive?: boolean; search?: string }) {
  const filter: FilterQuery<IDoctor> = {};
  if (q.departmentId) filter.department = q.departmentId;
  if (q.isActive !== undefined) filter.isActive = q.isActive;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    const users = await User.find({ role: 'DOCTOR', name: rx }).select('_id');
    filter.$or = [{ user: { $in: users.map((u) => u._id) } }, { specialization: rx }];
  }
  const [data, total] = await Promise.all([
    Doctor.find(filter).select('-__v').populate(doctorPopulate).sort({ _id: -1 }).skip(skipOf(q)).limit(q.limit).lean(),
    Doctor.countDocuments(filter),
  ]);
  return { data, meta: pageMeta(q, total) };
}

export async function updateDoctor(actor: Express.AuthUser, id: string, i: any) {
  const doctor = await Doctor.findById(id);
  if (!doctor) throw Errors.notFound('Doctor not found');
  if (i.departmentId) {
    const dept = await Department.findById(i.departmentId);
    if (!dept || !dept.isActive) throw Errors.unprocessable('Department not found or inactive');
    doctor.department = dept._id as Types.ObjectId;
  }
  for (const k of ['specialization', 'qualification', 'experienceYears', 'consultationFee', 'room'] as const) if (i[k] !== undefined) (doctor as any)[k] = i[k];
  const userPatch: Partial<IUser> = {};
  if (i.name) userPatch.name = i.name;
  if (i.password) userPatch.passwordHash = await hash(i.password);
  if (i.isActive !== undefined) { doctor.isActive = i.isActive; userPatch.isActive = i.isActive; }
  await doctor.save();
  if (Object.keys(userPatch).length) await User.updateOne({ _id: doctor.user }, { $set: userPatch });
  if (i.isActive === false || i.password) await revokeAllSessions(String(doctor.user));
  await audit({ userId: actor.id, role: actor.role, action: 'DOCTOR_UPDATED', entity: 'Doctor', entityId: doctor._id, metadata: { fields: Object.keys(i) } });
  return getDoctor(id);
}

/**
 * Permanently removes a doctor (profile, schedule and login). Appointments reference the doctor, so a doctor
 * who has any appointment, past or present, is never deleted: that would orphan clinical history. The caller
 * gets 409 HAS_APPOINTMENTS and should deactivate the doctor instead (PATCH { isActive: false }).
 */
export async function deleteDoctor(actor: Express.AuthUser, id: string) {
  const doctor = await Doctor.findById(id);
  if (!doctor) throw Errors.notFound('Doctor not found');
  // Block new bookings first (booking rejects inactive doctors), so none can slip in between the check and the delete.
  const wasActive = doctor.isActive;
  await Doctor.updateOne({ _id: doctor._id }, { $set: { isActive: false } });
  const appointments = await Appointment.countDocuments({ doctor: doctor._id });
  if (appointments > 0) {
    if (wasActive) await Doctor.updateOne({ _id: doctor._id }, { $set: { isActive: true } });
    throw new AppError(409, 'HAS_APPOINTMENTS', 'This doctor has appointment history and cannot be deleted. Deactivate the doctor instead.', { appointments });
  }
  await revokeAllSessions(String(doctor.user));
  await DoctorSchedule.deleteOne({ doctor: doctor._id });
  await Doctor.deleteOne({ _id: doctor._id });
  await User.deleteOne({ _id: doctor.user });
  await audit({ userId: actor.id, role: actor.role, action: 'DOCTOR_DELETED', entity: 'Doctor', entityId: doctor._id, metadata: { userId: String(doctor.user) } });
  return { id };
}

// ------------------------------------------------------------ receptionists
export async function createReceptionist(actor: Express.AuthUser, i: { name: string; email: string; password: string }) {
  const user = await createUser(i.name, i.email, i.password, 'RECEPTIONIST');
  await audit({ userId: actor.id, role: actor.role, action: 'RECEPTIONIST_CREATED', entity: 'User', entityId: user._id });
  return user;
}
export async function listReceptionists(q: { page: number; limit: number; isActive?: boolean; search?: string }) {
  const filter: FilterQuery<IUser> = { role: 'RECEPTIONIST' };
  if (q.isActive !== undefined) filter.isActive = q.isActive;
  if (q.search) { const rx = new RegExp(escapeRegex(q.search), 'i'); filter.$or = [{ name: rx }, { email: rx }]; }
  const [data, total] = await Promise.all([User.find(filter).select('-__v').sort({ _id: -1 }).skip(skipOf(q)).limit(q.limit).lean(), User.countDocuments(filter)]);
  return { data, meta: pageMeta(q, total) };
}
export async function getReceptionist(id: string) {
  const u = await User.findOne({ _id: id, role: 'RECEPTIONIST' });
  if (!u) throw Errors.notFound('Receptionist not found');
  return u;
}
export async function updateReceptionist(actor: Express.AuthUser, id: string, i: { name?: string; password?: string; isActive?: boolean }) {
  const patch: Partial<IUser> = {};
  if (i.name) patch.name = i.name;
  if (i.password) patch.passwordHash = await hash(i.password);
  if (i.isActive !== undefined) patch.isActive = i.isActive;
  const u = await User.findOneAndUpdate({ _id: id, role: 'RECEPTIONIST' }, { $set: patch }, { new: true, runValidators: true });
  if (!u) throw Errors.notFound('Receptionist not found');
  if (i.isActive === false || i.password) await revokeAllSessions(id);
  await audit({ userId: actor.id, role: actor.role, action: 'RECEPTIONIST_UPDATED', entity: 'User', entityId: u._id, metadata: { fields: Object.keys(i) } });
  return u;
}

/**
 * Permanently removes a receptionist login. Appointments record who created them, so a receptionist who has
 * booked any appointment is kept (409 HAS_APPOINTMENTS): deactivate instead (PATCH { isActive: false }).
 */
export async function deleteReceptionist(actor: Express.AuthUser, id: string) {
  const user = await User.findOne({ _id: id, role: 'RECEPTIONIST' });
  if (!user) throw Errors.notFound('Receptionist not found');
  const appointments = await Appointment.countDocuments({ createdBy: user._id });
  if (appointments > 0) {
    throw new AppError(409, 'HAS_APPOINTMENTS', 'This receptionist has booked appointments and cannot be deleted. Deactivate the account instead.', { appointments });
  }
  await revokeAllSessions(id);
  await User.deleteOne({ _id: user._id });
  await audit({ userId: actor.id, role: actor.role, action: 'RECEPTIONIST_DELETED', entity: 'User', entityId: user._id });
  return { id };
}
