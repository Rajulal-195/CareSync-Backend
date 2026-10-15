import { Schema, model, Types } from 'mongoose';
import { ROLES, Role } from './constants';

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
userSchema.index({ role: 1, isActive: 1 });
userSchema.set('toJSON', {
  transform: (_d, ret: any) => { delete ret.passwordHash; delete ret.__v; return ret; },
});

export const User = model<IUser>('User', userSchema);
