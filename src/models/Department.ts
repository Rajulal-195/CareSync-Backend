import { Schema, model, Types } from 'mongoose';

export interface IDepartment {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  isActive: boolean;
}
const schema = new Schema<IDepartment>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
// Case-insensitive uniqueness ("Cardiology" == "cardiology")
schema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Department = model<IDepartment>('Department', schema);
