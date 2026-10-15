import request from 'supertest';
import { createApp } from '../app';
import { AuditLog } from '../models/AuditLog';
import { ADMIN, SCHEDULE, auth, bootstrap, clearDb, futureDate, seedAdmin, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('envelope, errors, security, required endpoints, audit', () => {
  let ctx: Ctx;
  const date = futureDate();
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); ctx = await bootstrap(app); });

  describe('health, envelope and headers', () => {
    it('GET /health is public, enveloped and carries a request id', async () => {
      const res = await request(app).get('/api/v1/health').expect(200);
      expect(res.body).toMatchObject({ success: true, message: expect.any(String), data: { status: 'ok', db: 'up' }, meta: {} });
      expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);
      const echoed = await request(app).get('/api/v1/health').set('X-Request-Id', 'client-req-12345').expect(200);
      expect(echoed.headers['x-request-id']).toBe('client-req-12345');
    });

    it('every success response uses { success, message, data, meta }', async () => {
      for (const [path, token] of [['/auth/me', ctx.admin], ['/doctors', ctx.admin], ['/departments', ctx.rec], ['/patients', ctx.rec], ['/appointments', ctx.rec], ['/dashboard/stats', ctx.admin]] as const) {
        const res = await request(app).get(`/api/v1${path}`).set(auth(token)).expect(200);
        expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'meta', 'success']);
        expect(res.body.success).toBe(true);
      }
      const created = await request(app).post('/api/v1/departments').set(auth(ctx.admin)).send({ name: 'Neurology' }).expect(201);
      expect(created.body).toMatchObject({ success: true, message: 'Created successfully', data: { name: 'Neurology' } });
    });

    it('every error response uses { success:false, message, error:{code}, requestId }', async () => {
      const cases: [request.Test, number, string][] = [
        [request(app).get('/api/v1/auth/me'), 401, 'UNAUTHORIZED'],
        [request(app).get('/api/v1/doctors').set(auth(ctx.rec)), 403, 'FORBIDDEN'],
        [request(app).get('/api/v1/nope').set(auth(ctx.rec)), 404, 'NOT_FOUND'],
        [request(app).post('/api/v1/auth/login').send({ email: 'bad' }), 400, 'VALIDATION_ERROR'],
        [request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":'), 400, 'BAD_JSON'],
        [request(app).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'wrong-password-123' }), 401, 'UNAUTHORIZED'],
        [request(app).get('/api/v1/appointments?limit=999').set(auth(ctx.rec)), 400, 'VALIDATION_ERROR'],
      ];
      for (const [req, status, code] of cases) {
        const res = await req.expect(status);
        expect(res.body).toMatchObject({ success: false, message: expect.any(String), error: { code }, requestId: expect.any(String) });
        expect(res.body.data).toBeUndefined();
      }
    });

    it('sends secure headers and hides the framework', async () => {
      const res = await request(app).get('/api/v1/health').expect(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['referrer-policy']).toBeDefined();
    });

    it('serves OpenAPI docs', async () => {
      const res = await request(app).get('/api/docs.json').expect(200);
      expect(res.body.paths['/slots']).toBeDefined();
      expect(res.body.paths['/schedules/{doctorId}']).toBeDefined();
      expect(res.body.paths['/dashboard/stats']).toBeDefined();
    });
  });

  describe('CORS and origin policy', () => {
    it('refuses browser origins that are not allow-listed, accepts configured ones', async () => {
      await request(app).get('/api/v1/health').set('Origin', 'https://evil.example').expect(403);
      const ok = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173').expect(200);
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(ok.headers['access-control-allow-credentials']).toBe('true');
      await request(app).options('/api/v1/appointments').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST').expect(403);
    });
  });

  describe('NoSQL injection', () => {
    it('rejects operator objects in bodies, queries and params', async () => {
      await request(app).post('/api/v1/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } }).expect(400);
      await request(app).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'x', $where: '1==1' }).expect(400);
      await request(app).get('/api/v1/patients?q[$ne]=zzz').set(auth(ctx.rec)).expect(400);
      await request(app).get(`/api/v1/appointments/%7B%22$ne%22:null%7D`).set(auth(ctx.rec)).expect(400); // invalid id
      const nested = await request(app).post('/api/v1/patients').set(auth(ctx.rec)).send({ name: 'Eve Mallory', mobile: '9000000009', 'a.b': 1 }).expect(400);
      expect(nested.body.success).toBe(false);
    });
  });

  describe('required endpoints', () => {
    it('schedules: GET/PUT /schedules/:doctorId with role rules', async () => {
      await request(app).get(`/api/v1/schedules/${ctx.docA._id}`).set(auth(ctx.rec)).expect(200);
      expect((await request(app).get(`/api/v1/schedules/${ctx.docA._id}`).set(auth(ctx.docAToken)).expect(200)).body.data.slotDuration).toBe(30);
      await request(app).get(`/api/v1/schedules/${ctx.docB._id}`).set(auth(ctx.docAToken)).expect(404); // not their schedule
      await request(app).put(`/api/v1/schedules/${ctx.docA._id}`).set(auth(ctx.rec)).send(SCHEDULE).expect(403);
      await request(app).put(`/api/v1/schedules/${ctx.docA._id}`).set(auth(ctx.docAToken)).send(SCHEDULE).expect(403);
      const saved = await request(app).put(`/api/v1/schedules/${ctx.docA._id}`).set(auth(ctx.admin)).send({ ...SCHEDULE, slotDuration: 20 }).expect(200);
      expect(saved.body.data.slotDuration).toBe(20);
      await request(app).put(`/api/v1/schedules/${ctx.docA._id}`).set(auth(ctx.admin)).send({ ...SCHEDULE, slotDuration: 0 }).expect(400);
      await request(app).patch(`/api/v1/schedules/${ctx.docA._id}`).set(auth(ctx.admin)).send({ slotDuration: 30 }).expect(200);
    });

    it('PUT aliases: doctors, appointments, departments, receptionists, patients', async () => {
      const doc = await request(app).put(`/api/v1/doctors/${ctx.docA._id}`).set(auth(ctx.admin)).send({ specialization: 'Interventional Cardiology' }).expect(200);
      expect(doc.body.data.specialization).toBe('Interventional Cardiology');
      await request(app).put(`/api/v1/doctors/${ctx.docA._id}`).set(auth(ctx.rec)).send({ specialization: 'x y' }).expect(403);
      const appt = (await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: date, startTime: '09:00', purpose: 'Initial' }).expect(201)).body.data;
      const upd = await request(app).put(`/api/v1/appointments/${appt._id}`).set(auth(ctx.rec)).send({ purpose: 'Updated purpose' }).expect(200);
      expect(upd.body.data.purpose).toBe('Updated purpose');
      await request(app).put(`/api/v1/departments/${ctx.dept._id}`).set(auth(ctx.admin)).send({ description: 'Heart care' }).expect(200);
      expect((await request(app).get(`/api/v1/departments/${ctx.dept._id}`).set(auth(ctx.rec)).expect(200)).body.data.description).toBe('Heart care');
      await request(app).put(`/api/v1/patients/${ctx.p1._id}`).set(auth(ctx.rec)).send({ name: 'Pat Uno' }).expect(200);
    });

    it('GET /dashboard/stats returns the dashboard that matches the caller role', async () => {
      await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: date, startTime: '09:00', purpose: 'x' }).expect(201);
      const a = (await request(app).get(`/api/v1/dashboard/stats?date=${date}`).set(auth(ctx.admin)).expect(200)).body.data;
      expect(a).toMatchObject({ role: 'SUPER_ADMIN', appointmentsByStatus: { SCHEDULED: 1 } });
      expect(a.totals).toBeDefined();
      const r = (await request(app).get(`/api/v1/dashboard/stats?date=${date}`).set(auth(ctx.rec)).expect(200)).body.data;
      expect(r).toMatchObject({ role: 'RECEPTIONIST' });
      expect(r.awaitingArrival).toHaveLength(1);
      const d = (await request(app).get(`/api/v1/dashboard/stats?date=${date}`).set(auth(ctx.docAToken)).expect(200)).body.data;
      expect(d).toMatchObject({ role: 'DOCTOR', appointmentsByStatus: { SCHEDULED: 1 } });
      const other = (await request(app).get(`/api/v1/dashboard/stats?date=${date}`).set(auth(ctx.docBToken)).expect(200)).body.data;
      expect(other.appointmentsByStatus.SCHEDULED).toBe(0); // doctor stats are own-data only
      await request(app).get('/api/v1/dashboard/stats').expect(401);
    });
  });

  describe('sensitive data and audit logging', () => {
    it('never returns password hashes or tokens in any listing', async () => {
      const blobs = await Promise.all(['/auth/me', '/doctors', '/receptionists', '/patients', '/departments'].map(async (p) => JSON.stringify((await request(app).get(`/api/v1${p}`).set(auth(ctx.admin)).expect(200)).body)));
      for (const b of blobs) expect(b).not.toMatch(/passwordHash|refresh_token|\$2[aby]\$/);
    });

    it('audit trail covers auth, staff, schedule and appointment events with safe metadata', async () => {
      const appt = (await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: date, startTime: '09:00', purpose: 'Sensitive purpose text' }).expect(201)).body.data;
      await request(app).patch(`/api/v1/appointments/${appt._id}`).set(auth(ctx.rec)).send({ notes: 'Sensitive free-text note' }).expect(200);
      await request(app).post(`/api/v1/appointments/${appt._id}/arrive`).set(auth(ctx.rec)).expect(200);
      await request(app).post(`/api/v1/appointments/${appt._id}/cancel`).set(auth(ctx.rec)).send({ reason: 'Patient has a very private reason' }).expect(200);

      const actions = (await AuditLog.find().lean()).map((l) => l.action);
      for (const a of ['LOGIN_SUCCESS', 'DOCTOR_CREATED', 'RECEPTIONIST_CREATED', 'SCHEDULE_CREATED', 'DEPARTMENT_CREATED', 'PATIENT_REGISTERED', 'APPOINTMENT_CREATED', 'APPOINTMENT_UPDATED', 'APPOINTMENT_ARRIVED', 'APPOINTMENT_CANCELLED'])
        expect(actions).toContain(a);

      const all = JSON.stringify(await AuditLog.find().lean());
      for (const secret of ['Sensitive purpose text', 'Sensitive free-text note', 'very private reason', 'Pat One', '9876543210', 'Str0ngPassw0rd', 'alice@example.com'])
        expect(all).not.toContain(secret);
      const cancel = await AuditLog.findOne({ action: 'APPOINTMENT_CANCELLED' }).lean();
      expect(cancel).toMatchObject({ role: 'RECEPTIONIST', entity: 'Appointment', entityId: appt._id, metadata: { previousStatus: 'ARRIVED', justified: true } });
      expect(cancel!.user).toBeTruthy();
      expect(cancel!.timestamp).toBeInstanceOf(Date);
      const arrive = await AuditLog.findOne({ action: 'APPOINTMENT_ARRIVED' }).lean();
      expect(arrive!.metadata).toMatchObject({ from: 'SCHEDULED', to: 'ARRIVED' });
    });

    it('GET /audit-logs is SUPER_ADMIN only, filterable and paginated', async () => {
      await request(app).get('/api/v1/audit-logs').set(auth(ctx.rec)).expect(403);
      await request(app).get('/api/v1/audit-logs').set(auth(ctx.docAToken)).expect(403);
      const res = await request(app).get('/api/v1/audit-logs?action=LOGIN_SUCCESS&limit=2&page=1').set(auth(ctx.admin)).expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.data.every((l: any) => l.action === 'LOGIN_SUCCESS')).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 2 });
      await request(app).get('/api/v1/audit-logs?action=drop table').set(auth(ctx.admin)).expect(400);
      await request(app).get('/api/v1/audit-logs?action[$ne]=x').set(auth(ctx.admin)).expect(400);
    });

    it('records failed logins without storing the attempted email or password', async () => {
      await request(app).post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'Wr0ngPassword123' }).expect(401);
      const log = JSON.stringify(await AuditLog.findOne({ action: 'LOGIN_FAILURE' }).lean());
      expect(log).toContain('LOGIN_FAILURE');
      expect(log).not.toMatch(/ghost@example\.com|Wr0ngPassword123/);
    });
  });

  it('safe 500s: unexpected failures return a generic message', async () => {
    const mongoose = (await import('mongoose')).default;
    const spy = jest.spyOn(mongoose.Model, 'find').mockImplementation(() => { throw new Error('connection string mongodb://user:secret@host leaked'); });
    const res = await request(app).get('/api/v1/doctors').set(auth(ctx.admin)).expect(500);
    spy.mockRestore();
    expect(res.body).toMatchObject({ success: false, message: 'Internal server error', error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|mongodb:\/\//);
  });
});
void seedAdmin;
