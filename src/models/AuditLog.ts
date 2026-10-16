import { Schema, model, Types } from 'mongoose';
import { Role } from './constants';

export interface IAuditLog {
  user?: Types.ObjectId | null;
  role?: Role;
  action: string;
  entity: string;
  entityId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
const schema = new Schema<IAuditLog>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    role: { type: String },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String },
    timestamp: { type: Date, default: Date.now },
    metadata: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);
schema.index({ timestamp: -1, _id: -1 }); // unfiltered audit list
schema.index({ user: 1, timestamp: -1 });
schema.index({ action: 1, timestamp: -1 });
schema.index({ entity: 1, entityId: 1 });
export const AuditLog = model<IAuditLog>('AuditLog', schema);
