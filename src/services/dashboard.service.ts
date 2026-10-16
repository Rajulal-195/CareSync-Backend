import { Types } from 'mongoose';
import { env } from '../config/env';
import { Appointment } from '../models/Appointment';
import { APPOINTMENT_STATUSES } from '../models/constants';
import { Department } from '../models/Department';
import { Doctor } from '../models/Doctor';
import { Patient } from '../models/Patient';
import { User } from '../models/User';
import { nowInTimezone } from '../utils/time';

const today = () => nowInTimezone(env.APP_TIMEZONE).date;
const statusMap = (rows: { _id: string; count: number }[]) => {
  const m: Record<string, number> = Object.fromEntries(APPOINTMENT_STATUSES.map((s) => [s, 0]));
  rows.forEach((r) => { m[r._id] = r.count; });
  return m;
};
const byStatus = (match: object) => Appointment.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);

export async function adminDashboard(date = today()) {
  const [status, doctors, receptionists, patients, departments, perDept, perDoctor] = await Promise.all([
    byStatus({ appointmentDate: date }),
    Doctor.countDocuments({ isActive: true }),
    User.countDocuments({ role: 'RECEPTIONIST', isActive: true }),
    Patient.estimatedDocumentCount(),
    Department.countDocuments({ isActive: true }),
    Appointment.aggregate([
      { $match: { appointmentDate: date, status: { $ne: 'CANCELLED' } } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
      { $project: { _id: 0, departmentId: '$_id', name: { $arrayElemAt: ['$dept.name', 0] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),
    Appointment.aggregate([
      { $match: { appointmentDate: date, status: { $ne: 'CANCELLED' } } },
      { $group: { _id: '$doctor', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 },
      { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'd' } },
      { $lookup: { from: 'users', localField: 'd.user', foreignField: '_id', as: 'u' } },
      { $project: { _id: 0, doctorId: '$_id', name: { $arrayElemAt: ['$u.name', 0] }, count: 1 } },
    ]),
  ]);
  return { date, appointmentsByStatus: statusMap(status), totals: { activeDoctors: doctors, activeReceptionists: receptionists, patients, activeDepartments: departments }, appointmentsPerDepartment: perDept, busiestDoctors: perDoctor };
}

export async function receptionistDashboard(date = today()) {
  const [status, awaiting, waiting] = await Promise.all([
    byStatus({ appointmentDate: date }),
    Appointment.find({ appointmentDate: date, status: 'SCHEDULED' }).sort({ startTime: 1 }).limit(20)
      .populate('patient', 'patientId name mobile').populate({ path: 'doctor', select: 'user', populate: { path: 'user', select: 'name' } }).lean(),
    Appointment.find({ appointmentDate: date, status: 'ARRIVED' }).sort({ arrivedAt: 1 }).limit(20)
      .populate('patient', 'patientId name').populate({ path: 'doctor', select: 'user', populate: { path: 'user', select: 'name' } }).lean(),
  ]);
  return { date, appointmentsByStatus: statusMap(status), awaitingArrival: awaiting, waitingRoom: waiting };
}

export async function doctorDashboard(actor: Express.AuthUser, date = today()) {
  const match = { appointmentDate: date, doctor: new Types.ObjectId(actor.doctorId) };
  const [status, list] = await Promise.all([
    byStatus(match),
    Appointment.find({ appointmentDate: date, doctor: actor.doctorId, status: { $in: ['SCHEDULED', 'ARRIVED'] } }).sort({ startTime: 1 }).populate('patient', 'patientId name').lean(),
  ]);
  return { date, appointmentsByStatus: statusMap(status), upcoming: list };
}
