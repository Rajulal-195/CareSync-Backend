import { z } from 'zod';
import { dateStr, email, pagination } from './common';
import { GENDERS } from '../models/constants';

const fields = {
  name: z.string().trim().min(2).max(100),
  mobile: z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Mobile must be 7-15 digits, optional leading +'),
  email: email.optional(),
  dateOfBirth: dateStr.refine((d) => d <= new Date().toISOString().slice(0, 10), 'Date of birth cannot be in the future').optional(),
  gender: z.enum(GENDERS).optional(),
};
export const createPatientBody = z.object(fields).strict();
export const updatePatientBody = z
  .object({ name: fields.name.optional(), mobile: fields.mobile.optional(), email: fields.email, dateOfBirth: fields.dateOfBirth, gender: fields.gender })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const searchPatientsQuery = z.object({
  ...pagination,
  q: z.string().trim().min(2).max(100).optional(),
  sortBy: z.enum(['createdAt', 'name', 'patientId']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
