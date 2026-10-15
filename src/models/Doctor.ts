import { Schema, model, Types } from 'mongoose';

export interface IDoctor {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  department: Types.ObjectId;
  specialization: string;
  qualification?: string;
  experienceYears?: number;
  consultationFee: number;
  room?: string;
  isActive: boolean;
}
const schema = new Schema<IDoctor>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    specialization: { type: String, required: true, trim: true, maxlength: 100 },
    qualification: { type: String, trim: true, maxlength: 200 },
    experienceYears: { type: Number, min: 0, max: 80 },
    consultationFee: { type: Number, min: 0, default: 0 },
    room: { type: String, trim: true, maxlength: 50 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
schema.index({ department: 1, isActive: 1 });
export const Doctor = model<IDoctor>('Doctor', schema);
