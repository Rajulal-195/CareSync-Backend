export const ROLES = ['SUPER_ADMIN', 'RECEPTIONIST', 'DOCTOR'] as const;
export type Role = (typeof ROLES)[number];

export const APPOINTMENT_STATUSES = ['SCHEDULED', 'ARRIVED', 'COMPLETED', 'CANCELLED'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/**
 * Statuses that OCCUPY a slot. Single source of truth: used by the partial unique index,
 * the overlap check in the service layer, and slot availability. Only CANCELLED frees a slot.
 */
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'ARRIVED', 'COMPLETED'];

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

/**
 * Allowed lifecycle transitions (single source of truth for the service layer and docs).
 * ARRIVED -> CANCELLED is allowed on purpose (patient arrives, then leaves before the consultation)
 * but the service requires a cancellation reason for it. COMPLETED and CANCELLED are terminal.
 */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
