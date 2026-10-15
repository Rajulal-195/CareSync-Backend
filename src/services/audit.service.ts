import { FilterQuery, Types } from 'mongoose';
import { AuditLog, IAuditLog } from '../models/AuditLog';
import { Role } from '../models/constants';
import { logger } from '../utils/logger';
import { pageMeta, skipOf } from '../utils/pagination';

// Keys that could carry credentials or patient data are dropped; only short primitives / string arrays survive.
const SENSITIVE = /pass|token|secret|hash|authorization|cookie|reason|notes|name|mobile|phone|email|birth|dob|purpose|gender/i;
function clean(m?: Record<string, unknown>) {
  if (!m) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (SENSITIVE.test(k) || v === undefined) continue;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) out[k] = v.slice(0, 50);
  }
  return out;
}

export interface AuditEvent {
  userId?: string | Types.ObjectId | null;
  role?: Role;
  action: string;
  entity: string;
  entityId?: string | Types.ObjectId;
  metadata?: Record<string, unknown>;
}

/** Never throws: auditing failures must not break the user-facing operation. */
export async function audit(e: AuditEvent) {
  try {
    await AuditLog.create({
      user: e.userId ?? null, role: e.role, action: e.action, entity: e.entity,
      entityId: e.entityId ? String(e.entityId) : undefined, metadata: clean(e.metadata),
    });
  } catch (err) {
    logger.error('audit_write_failed', err as Error);
  }
}

export async function listAuditLogs(q: { page: number; limit: number; action?: string; userId?: string; entity?: string; entityId?: string; dateFrom?: string; dateTo?: string; sortOrder: 'asc' | 'desc' }) {
  const filter: FilterQuery<IAuditLog> = {};
  if (q.action) filter.action = q.action;
  if (q.userId) filter.user = q.userId;
  if (q.entity) filter.entity = q.entity;
  if (q.entityId) filter.entityId = q.entityId;
  if (q.dateFrom || q.dateTo) filter.timestamp = { ...(q.dateFrom ? { $gte: new Date(`${q.dateFrom}T00:00:00.000Z`) } : {}), ...(q.dateTo ? { $lte: new Date(`${q.dateTo}T23:59:59.999Z`) } : {}) };
  const dir = q.sortOrder === 'asc' ? 1 : -1;
  const [data, total] = await Promise.all([
    AuditLog.find(filter).select('-__v').sort({ timestamp: dir, _id: dir }).skip(skipOf(q)).limit(q.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { data, meta: pageMeta(q, total, { sortBy: 'timestamp', sortOrder: q.sortOrder }) };
}
