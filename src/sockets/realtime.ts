import type { Server } from 'socket.io';

let io: Server | null = null;
export const setIO = (s: Server | null) => { io = s; };

export type AppointmentEvent = 'created' | 'updated' | 'cancelled' | 'status-changed';
interface Brief { id: string; doctor: string; status: string; appointmentDate: string; startTime: string }

/**
 * Called ONLY after the database write has succeeded (and, for transactions, committed).
 * Rooms: admins, receptionists, and the assigned doctor's private room. The payload is minimal by design:
 * identifiers + status + slot coordinates, no patient data. Events are hints, never the source of truth:
 * clients must re-fetch through the authorised REST API.
 */
export function emitAppointmentEvent(event: AppointmentEvent, a: Brief, opts: { previousStatus?: string; extraDoctorIds?: string[] } = {}) {
  if (!io) return;
  const rooms = ['role:SUPER_ADMIN', 'role:RECEPTIONIST', ...[a.doctor, ...(opts.extraDoctorIds ?? [])].map((d) => `doctor:${d}`)];
  io.to(rooms).emit(`appointment:${event}`, {
    id: a.id, doctorId: a.doctor, status: a.status, appointmentDate: a.appointmentDate, startTime: a.startTime,
    ...(opts.previousStatus ? { previousStatus: opts.previousStatus } : {}), at: new Date().toISOString(),
  });
}

/** Tells booking staff that availability for a doctor/day changed (they re-fetch GET /slots). Doctors don't need it. */
export function emitSlotUpdated(doctorId: string, appointmentDate: string) {
  if (!io) return;
  io.to(['role:SUPER_ADMIN', 'role:RECEPTIONIST']).emit('slot:updated', { doctorId, appointmentDate, at: new Date().toISOString() });
}
