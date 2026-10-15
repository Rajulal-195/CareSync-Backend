import request from 'supertest';
import { createApp } from '../app';
import { auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('RBAC and record-level authorization', () => {
  let ctx: Ctx;
  let apptA: any;
  let apptB: any;
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => {
    await clearDb();
    ctx = await bootstrap(app);
    const book = async (doc: any, patient: any, startTime: string) =>
      (await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: patient._id, doctorId: doc._id, appointmentDate: futureDate(), startTime, purpose: 'Checkup' }).expect(201)).body.data;
    apptA = await book(ctx.docA, ctx.p1, '09:00');
    apptB = await book(ctx.docB, ctx.p2, '09:00');
  });

  it('requires authentication everywhere', async () => {
    for (const path of ['/doctors', '/patients', '/appointments', '/dashboard/admin', '/departments']) await request(app).get(`/api/v1${path}`).expect(401);
  });

  it('doctor only lists their own appointments, even when filtering by another doctor', async () => {
    const mine = await request(app).get('/api/v1/appointments').set(auth(ctx.docAToken)).expect(200);
    expect(mine.body.data.map((a: any) => a._id)).toEqual([apptA._id]);
    const spoof = await request(app).get(`/api/v1/appointments?doctorId=${ctx.docB._id}`).set(auth(ctx.docAToken)).expect(200);
    expect(spoof.body.data.map((a: any) => a._id)).toEqual([apptA._id]);
    const patientSpoof = await request(app).get(`/api/v1/appointments?patientId=${ctx.p2._id}`).set(auth(ctx.docAToken)).expect(200);
    expect(patientSpoof.body.data).toHaveLength(0);
  });

  it("doctor cannot read, annotate or learn about another doctor's appointment or patient", async () => {
    await request(app).get(`/api/v1/appointments/${apptB._id}`).set(auth(ctx.docAToken)).expect(404);
    await request(app).get(`/api/v1/appointments/${apptA._id}`).set(auth(ctx.docAToken)).expect(200);
    await request(app).patch(`/api/v1/appointments/${apptB._id}/consultation`).set(auth(ctx.docAToken)).send({ consultationNotes: 'x' }).expect(404);
    await request(app).get(`/api/v1/patients/${ctx.p2._id}`).set(auth(ctx.docAToken)).expect(404);
    const own = await request(app).get(`/api/v1/patients/${ctx.p1._id}`).set(auth(ctx.docAToken)).expect(200);
    expect(own.body.data.name).toBe('Pat One');
  });

  it('doctor cannot use admin or receptionist capabilities', async () => {
    const t = ctx.docAToken;
    await request(app).get('/api/v1/patients').set(auth(t)).expect(403);
    await request(app).get('/api/v1/doctors').set(auth(t)).expect(403);
    await request(app).get('/api/v1/dashboard/admin').set(auth(t)).expect(403);
    await request(app).post('/api/v1/appointments').set(auth(t)).send({}).expect(403);
    await request(app).post(`/api/v1/appointments/${apptA._id}/cancel`).set(auth(t)).send({}).expect(403);
    await request(app).post(`/api/v1/appointments/${apptA._id}/arrive`).set(auth(t)).expect(403);
  });

  it('receptionist cannot manage staff, departments or schedules; admin cannot book', async () => {
    const dto = { name: 'Dr X', email: 'x@example.com', password: 'Str0ngPassw0rd!', departmentId: ctx.dept._id, specialization: 'x' };
    await request(app).post('/api/v1/doctors').set(auth(ctx.rec)).send(dto).expect(403);
    await request(app).post('/api/v1/receptionists').set(auth(ctx.rec)).send({ name: 'R', email: 'r@example.com', password: dto.password }).expect(403);
    await request(app).post('/api/v1/departments').set(auth(ctx.rec)).send({ name: 'Neuro' }).expect(403);
    await request(app).get('/api/v1/dashboard/admin').set(auth(ctx.rec)).expect(403);
    await request(app).post('/api/v1/appointments').set(auth(ctx.admin)).send({}).expect(403);
  });

  it('admin and receptionist see all appointments; admin dashboard works', async () => {
    const all = await request(app).get('/api/v1/appointments').set(auth(ctx.admin)).expect(200);
    expect(all.body.data).toHaveLength(2);
    expect((await request(app).get('/api/v1/appointments').set(auth(ctx.rec)).expect(200)).body.data).toHaveLength(2);
    const dash = await request(app).get(`/api/v1/dashboard/admin?date=${futureDate()}`).set(auth(ctx.admin)).expect(200);
    expect(dash.body.data.appointmentsByStatus.SCHEDULED).toBe(2);
    const rdash = await request(app).get(`/api/v1/dashboard/receptionist?date=${futureDate()}`).set(auth(ctx.rec)).expect(200);
    expect(rdash.body.data.awaitingArrival).toHaveLength(2);
    const ddash = await request(app).get(`/api/v1/dashboard/doctor?date=${futureDate()}`).set(auth(ctx.docAToken)).expect(200);
    expect(ddash.body.data.upcoming).toHaveLength(1);
  });

  it('duplicate staff email is rejected and passwords never appear in responses', async () => {
    const dto = { name: 'Dr Dup', email: 'alice@example.com', password: 'Str0ngPassw0rd!', departmentId: ctx.dept._id, specialization: 'x' };
    await request(app).post('/api/v1/doctors').set(auth(ctx.admin)).send(dto).expect(409);
    const list = await request(app).get('/api/v1/doctors').set(auth(ctx.admin)).expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash/);
  });

  it('weak passwords and invalid schedules are rejected', async () => {
    await request(app).post('/api/v1/receptionists').set(auth(ctx.admin)).send({ name: 'Weak', email: 'weak@example.com', password: 'short' }).expect(400);
    const bad = { timezone: 'Mars/Base', workingDays: [1], sessions: [{ start: '09:00', end: '12:00' }], slotDuration: 30 };
    await request(app).put(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(ctx.admin)).send(bad).expect(400);
    const overlap = { ...bad, timezone: 'UTC', sessions: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] };
    await request(app).put(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(ctx.admin)).send(overlap).expect(400);
  });
});
