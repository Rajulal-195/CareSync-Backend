import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { isValidObjectId } from 'mongoose';
import { AUDIENCE, ISSUER, env } from '../config/env';
import { Doctor } from '../models/Doctor';
import { RefreshSession } from '../models/RefreshSession';
import { User } from '../models/User';
import { Errors } from '../utils/errors';
import { randomToken, sha256 } from '../utils/crypto';
import { audit } from './audit.service';

export interface ReqCtx { ip?: string; userAgent?: string }

// Compared against when the email is unknown so response time doesn't reveal account existence.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-password', 10);
const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TTL_SECONDS * 1000);

const signAccess = (user: { id: string; role: string }) =>
  jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id, issuer: ISSUER, audience: AUDIENCE, algorithm: 'HS256', expiresIn: env.ACCESS_TTL_SECONDS,
  });
const signRefresh = (userId: string, sid: string, jti: string) =>
  jwt.sign({ sid, jti }, env.JWT_REFRESH_SECRET, {
    subject: userId, issuer: ISSUER, algorithm: 'HS256', expiresIn: env.REFRESH_TTL_SECONDS,
  });

export async function login(email: string, password: string, ctx: ReqCtx) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.isActive) {
    await audit({ userId: user?._id, role: user?.role, action: 'LOGIN_FAILURE', entity: 'Auth', metadata: { ip: ctx.ip, cause: !user ? 'unknown_user' : !user.isActive ? 'inactive' : 'bad_password' } });
    throw Errors.unauthorized('Invalid email or password');
  }
  const jti = randomToken();
  const session = await RefreshSession.create({ user: user._id, tokenHash: sha256(jti), expiresAt: refreshExpiry(), ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) });
  await audit({ userId: user._id, role: user.role, action: 'LOGIN_SUCCESS', entity: 'Auth', entityId: session._id, metadata: { ip: ctx.ip } });
  return {
    accessToken: signAccess({ id: user.id, role: user.role }),
    refreshToken: signRefresh(user.id, session.id, jti),
    user: user.toJSON(),
  };
}

/** Rotates the refresh token. Presenting an already-rotated token is treated as theft: all sessions are revoked. */
export async function refresh(token: string, ctx: ReqCtx) {
  let p: any;
  try {
    p = jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER, algorithms: ['HS256'] });
  } catch {
    throw Errors.unauthorized('Session expired or invalid');
  }
  if (!isValidObjectId(p.sid) || !isValidObjectId(p.sub) || typeof p.jti !== 'string') throw Errors.unauthorized('Session expired or invalid');

  const newJti = randomToken();
  const rotated = await RefreshSession.findOneAndUpdate(
    { _id: p.sid, user: p.sub, tokenHash: sha256(p.jti), revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { tokenHash: sha256(newJti), expiresAt: refreshExpiry(), ip: ctx.ip } },
    { new: true },
  );

  if (!rotated) {
    const existing = await RefreshSession.findById(p.sid);
    if (existing && !existing.revokedAt && existing.expiresAt > new Date()) {
      await RefreshSession.updateMany({ user: p.sub, revokedAt: null }, { $set: { revokedAt: new Date() } });
      await audit({ userId: p.sub, action: 'REFRESH_TOKEN_REUSE_DETECTED', entity: 'Auth', entityId: p.sid, metadata: { ip: ctx.ip } });
    }
    throw Errors.unauthorized('Session expired or invalid');
  }

  const user = await User.findById(p.sub);
  if (!user || !user.isActive) {
    await RefreshSession.updateOne({ _id: rotated._id }, { $set: { revokedAt: new Date() } });
    throw Errors.unauthorized('Account disabled');
  }
  return { accessToken: signAccess({ id: user.id, role: user.role }), refreshToken: signRefresh(user.id, rotated.id, newJti), user: user.toJSON() };
}

export async function logout(token: string | undefined, ctx: ReqCtx) {
  if (!token) return;
  try {
    const p: any = jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER, algorithms: ['HS256'], ignoreExpiration: true });
    if (!isValidObjectId(p.sid) || !isValidObjectId(p.sub)) return;
    await RefreshSession.updateOne({ _id: p.sid, user: p.sub, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const u = await User.findById(p.sub).select('role');
    await audit({ userId: p.sub, role: u?.role, action: 'LOGOUT', entity: 'Auth', entityId: p.sid, metadata: { ip: ctx.ip } });
  } catch { /* invalid token: nothing to revoke */ }
}

export async function revokeAllSessions(userId: string) {
  await RefreshSession.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/** Verifies an access token and loads the live user (so deactivation takes effect immediately). */
export async function authenticateAccessToken(token: string): Promise<Express.AuthUser> {
  let p: any;
  try {
    p = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
  } catch {
    throw Errors.unauthorized('Invalid or expired access token');
  }
  if (!isValidObjectId(p.sub)) throw Errors.unauthorized('Invalid access token');
  const user = await User.findById(p.sub);
  if (!user || !user.isActive) throw Errors.unauthorized('Account not found or disabled');
  const au: Express.AuthUser = { id: user.id, role: user.role, name: user.name, tokenExp: p.exp };
  if (user.role === 'DOCTOR') {
    const d = await Doctor.findOne({ user: user._id, isActive: true }).select('_id');
    if (!d) throw Errors.forbidden('Doctor profile is inactive');
    au.doctorId = d.id;
  }
  return au;
}

export async function getMe(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw Errors.unauthorized();
  const doctor = user.role === 'DOCTOR' ? await Doctor.findOne({ user: user._id }).populate('department', 'name') : null;
  return { user: user.toJSON(), doctor };
}
