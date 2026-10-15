import { Schema, model, Types } from 'mongoose';

export interface ISchedule {
  _id: Types.ObjectId;
  doctor: Types.ObjectId;
  timezone: string;
  workingDays: number[]; // 0 = Sunday ... 6 = Saturday
  sessions: { start: string; end: string }[]; // applied to every working day
  slotDuration: number; // minutes
  breaks: { start: string; end: string }[];
  isActive: boolean;
}
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const interval = new Schema({ start: { type: String, match: hhmm, required: true }, end: { type: String, match: hhmm, required: true } }, { _id: false });

const schema = new Schema<ISchedule>(
  {
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, unique: true },
    timezone: { type: String, required: true },
    workingDays: { type: [{ type: Number, min: 0, max: 6 }], required: true },
    sessions: { type: [interval], required: true },
    slotDuration: { type: Number, required: true, min: 5, max: 240 },
    breaks: { type: [interval], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const DoctorSchedule = model<ISchedule>('DoctorSchedule', schema);
