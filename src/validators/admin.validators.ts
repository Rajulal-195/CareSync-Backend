import { z } from 'zod';
import { boolQuery, email, objectId, pagination, password, timeStr } from './common';
import { Interval, isValidTimezone, toMinutes } from '../utils/time';

const name = z.string().trim().min(2).max(100);

// ---- departments
export const createDepartmentBody = z.object({ name, description: z.string().trim().max(500).optional() }).strict();
export const updateDepartmentBody = z
  .object({ name: name.optional(), description: z.string().trim().max(500).optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const listDepartmentsQuery = z.object({ isActive: boolQuery.optional() });

// ---- doctors
const doctorProfile = {
  specialization: z.string().trim().min(2).max(100),
  qualification: z.string().trim().max(200).optional(),
  experienceYears: z.number().int().min(0).max(80).optional(),
  consultationFee: z.number().min(0).max(1_000_000).optional(),
  room: z.string().trim().max(50).optional(),
};
export const createDoctorBody = z.object({ name, email, password, departmentId: objectId, ...doctorProfile }).strict();
export const updateDoctorBody = z
  .object({
    name: name.optional(),
    password: password.optional(), // admin-initiated password reset
    departmentId: objectId.optional(),
    isActive: z.boolean().optional(),
    ...Object.fromEntries(Object.entries(doctorProfile).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const listDoctorsQuery = z.object({
  ...pagination,
  departmentId: objectId.optional(),
  isActive: boolQuery.optional(),
  search: z.string().trim().max(100).optional(),
});

// ---- receptionists
export const createReceptionistBody = z.object({ name, email, password }).strict();
export const updateReceptionistBody = z
  .object({ name: name.optional(), password: password.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const listReceptionistsQuery = z.object({ ...pagination, isActive: boolQuery.optional(), search: z.string().trim().max(100).optional() });

// ---- schedule
const interval = z
  .object({ start: timeStr, end: timeStr })
  .strict()
  .refine((s) => toMinutes(s.start) < toMinutes(s.end), 'start must be before end');
const overlaps = (a: Interval, b: Interval) => toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);

const scheduleObject = z
  .object({
    timezone: z.string().refine(isValidTimezone, 'Invalid IANA timezone'),
    workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    sessions: z.array(interval).min(1).max(6),
    slotDuration: z.number().int().min(5, 'slotDuration must be 5-240 minutes').max(240, 'slotDuration must be 5-240 minutes'),
    breaks: z.array(interval).max(10).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

function checkSchedule(v: z.infer<typeof scheduleObject>, ctx: z.RefinementCtx) {
  const breaks = v.breaks ?? [];
  if (new Set(v.workingDays).size !== v.workingDays.length)
    ctx.addIssue({ code: 'custom', path: ['workingDays'], message: 'Duplicate working days' });
  v.sessions.forEach((a, i) =>
    v.sessions.forEach((b, j) => {
      if (i < j && overlaps(a, b)) ctx.addIssue({ code: 'custom', path: ['sessions', j], message: 'Sessions must not overlap' });
    }),
  );
  breaks.forEach((a, i) => {
    if (!v.sessions.some((s) => toMinutes(a.start) >= toMinutes(s.start) && toMinutes(a.end) <= toMinutes(s.end)))
      ctx.addIssue({ code: 'custom', path: ['breaks', i], message: 'Break must be fully inside a single session' });
    breaks.forEach((b, j) => {
      if (i < j && overlaps(a, b)) ctx.addIssue({ code: 'custom', path: ['breaks', j], message: 'Breaks must not overlap' });
    });
  });
  if (!v.sessions.some((s) => toMinutes(s.end) - toMinutes(s.start) >= v.slotDuration))
    ctx.addIssue({ code: 'custom', path: ['slotDuration'], message: 'slotDuration does not fit in any session' });
}

/** Full create/replace (PUT). Defaults are applied after validation. */
export const scheduleBody = scheduleObject
  .superRefine(checkSchedule)
  .transform((v) => ({ ...v, breaks: v.breaks ?? [], isActive: v.isActive ?? true }));
/** Partial update (PATCH). The service merges with the stored schedule and re-validates the result with `scheduleBody`. */
export const schedulePatchBody = scheduleObject.partial().refine((v) => Object.keys(v).length > 0, 'At least one field is required');
