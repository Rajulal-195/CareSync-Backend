import { Schema, model, Types } from 'mongoose';
import { GENDERS } from './constants';

export interface IPatient {
  _id: Types.ObjectId;
  patientId: string;
  name: string;
  mobile: string;
  email?: string;
  dateOfBirth?: Date;
  gender?: (typeof GENDERS)[number];
  createdAt: Date;
}
const schema = new Schema<IPatient>(
  {
    patientId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    mobile: { type: String, required: true, trim: true, match: /^\+?[0-9]{7,15}$/ },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: GENDERS },
  },
  { timestamps: true },
);
schema.index({ mobile: 1 });
schema.index({ name: 1, _id: 1 });          // sortBy=name with the _id tie-breaker
schema.index({ createdAt: -1, _id: -1 });   // default patient list sort
export const Patient = model<IPatient>('Patient', schema);
