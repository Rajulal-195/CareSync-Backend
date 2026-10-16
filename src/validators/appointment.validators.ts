import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '../models/constants';
import { dateStr, objectId, pagination, timeStr } from './common';
import { createPatientBody } from './patient.validators';

export const createAppointmentBody = z
  .object({
    patientId: objectId.optional(), // existing patient (_id from patient search) ...
    newPatient: createPatientBody.optional(), // ... or register a new one atomically with the booking
    doctorId: objectId,
    appointmentDate: dateStr,
    startTime: timeStr,
    purpose: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.patientId) !== Boolean(v.newPatient), { message: 'Provide exactly one of patientId or newPatient', path: ['patientId'] });

export const updateAppointmentBody = z
  .object({
    doctorId: objectId.optional(),
    appointmentDate: dateStr.optional(),
    startTime: timeStr.optional(),
    purpose: z.string().trim().min(1).max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const cancelAppointmentBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const consultationBody = z
  .object({ consultationNotes: z.string().trim().max(10000).optional(), complete: z.boolean().optional() })
  .strict()
  .refine((v) => v.consultationNotes !== undefined || v.complete !== undefined, 'Provide consultationNotes and/or complete');

export const APPOINTMENT_SORT_FIELDS = ['appointmentDate', 'startTime', 'createdAt', 'status'] as const; // allowlist: never a raw client field
const statusList = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.enum(APPOINTMENT_STATUSES)).min(1).max(4));

export const listAppointmentsQuery = z
  .object({
    ...pagination,
    q: z.string().trim().min(2).max(100).optional(), // free text: patient name / patient ID (PT-...) / mobile
    patientName: z.string().trim().min(2).max(100).optional(),
    patientCode: z.string().trim().regex(/^PT-\d{1,10}$/i, 'patientCode looks like PT-000001').optional(),
    mobile: z.string().trim().regex(/^\+?[0-9]{3,15}$/, 'mobile must be 3-15 digits').optional(),
    status: statusList.optional(), // one or several, e.g. status=SCHEDULED,ARRIVED
    doctorId: objectId.optional(),
    patientId: objectId.optional(), // patient document id (from patient search)
    departmentId: objectId.optional(),
    date: dateStr.optional(),
    dateFrom: dateStr.optional(),
    dateTo: dateStr.optional(),
    sortBy: z.enum(APPOINTMENT_SORT_FIELDS).default('appointmentDate'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  })
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, { message: 'dateFrom must not be after dateTo', path: ['dateFrom'] });

export const slotsQuery = z.object({ date: dateStr });
export const dashboardQuery = z.object({ date: dateStr.optional() });

export const deleteAppointmentQuery = z.object({ reason: z.string().trim().max(500).optional() });
export const completeBody = z.object({ consultationNotes: z.string().trim().max(10000).optional() }).strict();
export const slotsListQuery = z.object({ date: dateStr, doctorId: objectId.optional(), departmentId: objectId.optional() });
