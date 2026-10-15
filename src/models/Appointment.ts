import { Schema, model, Types } from 'mongoose';
import { ACTIVE_APPOINTMENT_STATUSES, APPOINTMENT_STATUSES, AppointmentStatus } from './constants';

export interface IAppointment {
  _id: Types.ObjectId;
  patient: Types.ObjectId;
  doctor: Types.ObjectId;
  department: Types.ObjectId;
  appointmentDate: string; // YYYY-MM-DD in the doctor's schedule timezone
  startTime: string; // HH:mm
  endTime: string;
  purpose: string;
  notes?: string;
  consultationNotes?: string;
  status: AppointmentStatus;
  createdBy: Types.ObjectId;
  arrivedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  cancelledBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const schema = new Schema<IAppointment>(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    appointmentDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    startTime: { type: String, required: true, match: hhmm },
    endTime: { type: String, required: true, match: hhmm },
    purpose: { type: String, required: true, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 2000 },
    consultationNotes: { type: String, trim: true, maxlength: 10000 },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'SCHEDULED', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    arrivedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelReason: { type: String, trim: true, maxlength: 500 },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Prevents double booking even under concurrent requests. CANCELLED rows are outside the
// partial filter, so a cancelled slot can be rebooked. Requires MongoDB >= 6.0 ($in in partial filters).
schema.index(
  { doctor: 1, appointmentDate: 1, startTime: 1 },
  {
    unique: true,
    name: 'uniq_active_doctor_slot',
    partialFilterExpression: { status: { $in: ACTIVE_APPOINTMENT_STATUSES } },
  },
);
schema.index({ doctor: 1, appointmentDate: 1, status: 1 });   // doctor day view / dashboards
schema.index({ appointmentDate: 1, status: 1 });              // receptionist + admin day views
schema.index({ patient: 1, appointmentDate: -1 });            // patient history, doctor->patient access check
schema.index({ department: 1, appointmentDate: 1 });          // per-department dashboard
schema.index({ status: 1, appointmentDate: 1, startTime: 1 }); // status-filtered, date-sorted worklists
schema.index({ createdAt: -1 });                              // sortBy=createdAt

export const Appointment = model<IAppointment>('Appointment', schema);
