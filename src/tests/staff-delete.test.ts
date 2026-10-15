import request from 'supertest';
import { createApp } from '../app';
import { AuditLog } from '../models/AuditLog';
import { Doctor } from '../models/Doctor';
import { DoctorSchedule } from '../models/DoctorSchedule';
import { User } from '../models/User';
import { PW, auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
const api = (path: string) => `/api/v1${path}`;

describe('deleting doctors and receptionists', () => {
  let ctx: Awaited<ReturnType<typeof bootstrap>>;
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); ctx = await bootstrap(app); });

  const book = (doctorId: string) =>
    request(app).post(api('/appointments')).set(auth(ctx.rec))
      .send({ patientId: ctx.p1._id, doctorId, appointmentDate: futureDate(), startTime: '09:00', purpose: 'Check-up' });

  describe('DELETE /doctors/:id', () => {
    it('removes a doctor with no appointments, together with their schedule and login', async () => {
      const userId = (await Doctor.findById(ctx.docB._id))!.user;
      const res = await request(app).delete(api(`/doctors/${ctx.docB._id}`)).set(auth(ctx.admin)).expect(200);
      expect(res.body).toMatchObject({ success: true, data: { id: ctx.docB._id } });

      expect(await Doctor.findById(ctx.docB._id)).toBeNull();
      expect(await DoctorSchedule.findOne({ doctor: ctx.docB._id })).toBeNull();
      expect(await User.findById(userId)).toBeNull();
      await request(app).post(api('/auth/login')).send({ email: 'bob@example.com', password: PW }).expect(401);
      await request(app).get(api(`/doctors/${ctx.docB._id}`)).set(auth(ctx.admin)).expect(404);
      expect(await AuditLog.countDocuments({ action: 'DOCTOR_DELETED', entityId: ctx.docB._id })).toBe(1);
    });

    it('keeps a doctor who has appointment history (409 HAS_APPOINTMENTS) and leaves them bookable', async () => {
      await book(ctx.docA._id).expect(201);
      const res = await request(app).delete(api(`/doctors/${ctx.docA._id}`)).set(auth(ctx.admin)).expect(409);
      expect(res.body.error).toMatchObject({ code: 'HAS_APPOINTMENTS', details: { appointments: 1 } });

      expect((await Doctor.findById(ctx.docA._id))!.isActive).toBe(true); // the safety check does not leave the doctor disabled
      expect(await DoctorSchedule.findOne({ doctor: ctx.docA._id })).not.toBeNull();
      await request(app).post(api('/auth/login')).send({ email: 'alice@example.com', password: PW }).expect(200);
    });

    it('lets the admin deactivate instead, which is what the 409 recommends', async () => {
      await book(ctx.docA._id).expect(201);
      await request(app).patch(api(`/doctors/${ctx.docA._id}`)).set(auth(ctx.admin)).send({ isActive: false }).expect(200);
      await request(app).post(api('/auth/login')).send({ email: 'alice@example.com', password: PW }).expect(401);
    });

    it('is Super Admin only and 404s for unknown ids', async () => {
      await request(app).delete(api(`/doctors/${ctx.docB._id}`)).set(auth(ctx.rec)).expect(403);
      await request(app).delete(api(`/doctors/${ctx.docB._id}`)).set(auth(ctx.docBToken)).expect(403);
      await request(app).delete(api(`/doctors/${ctx.docB._id}`)).expect(401);
      await request(app).delete(api('/doctors/64b7f0f0f0f0f0f0f0f0f0f0')).set(auth(ctx.admin)).expect(404);
      await request(app).delete(api('/doctors/not-an-id')).set(auth(ctx.admin)).expect(400);
      expect(await Doctor.findById(ctx.docB._id)).not.toBeNull();
    });
  });

  describe('DELETE /receptionists/:id', () => {
    const create = async (email: string) =>
      (await request(app).post(api('/receptionists')).set(auth(ctx.admin)).send({ name: 'Temp Desk', email, password: PW }).expect(201)).body.data;

    it('removes a receptionist who has not booked anything and ends their access', async () => {
      const r = await create('temp@example.com');
      const res = await request(app).delete(api(`/receptionists/${r._id}`)).set(auth(ctx.admin)).expect(200);
      expect(res.body.data).toEqual({ id: r._id });
      expect(await User.findById(r._id)).toBeNull();
      await request(app).post(api('/auth/login')).send({ email: 'temp@example.com', password: PW }).expect(401);
      expect(await AuditLog.countDocuments({ action: 'RECEPTIONIST_DELETED', entityId: r._id })).toBe(1);
    });

    it('keeps a receptionist who booked appointments (409 HAS_APPOINTMENTS)', async () => {
      await book(ctx.docA._id).expect(201);
      const rita = (await User.findOne({ email: 'rita@example.com' }))!;
      const res = await request(app).delete(api(`/receptionists/${rita.id}`)).set(auth(ctx.admin)).expect(409);
      expect(res.body.error.code).toBe('HAS_APPOINTMENTS');
      expect(await User.findById(rita.id)).not.toBeNull();
    });

    it('only deletes receptionists (never other roles), and only for the Super Admin', async () => {
      const doctorUser = (await Doctor.findById(ctx.docB._id))!.user;
      await request(app).delete(api(`/receptionists/${doctorUser}`)).set(auth(ctx.admin)).expect(404);
      expect(await User.findById(doctorUser)).not.toBeNull();
      const r = await create('temp2@example.com');
      await request(app).delete(api(`/receptionists/${r._id}`)).set(auth(ctx.rec)).expect(403);
      await request(app).delete(api(`/receptionists/${r._id}`)).set(auth(ctx.docAToken)).expect(403);
    });
  });
});
