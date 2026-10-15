import { Schema, model, Types } from 'mongoose';

export interface IRefreshSession {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  tokenHash: string; // sha256 of the CURRENT refresh token's jti
  expiresAt: Date;
  revokedAt?: Date | null;
  userAgent?: string;
  ip?: string;
}
const schema = new Schema<IRefreshSession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: true },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup of expired sessions
export const RefreshSession = model<IRefreshSession>('RefreshSession', schema);
