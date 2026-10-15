import request from 'supertest';
import { createApp } from '../app';
import { Appointment } from '../models/Appointment';
import { AuditLog } from '../models/AuditLog';
import { auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('appointment lifecycle', () => {
  let ctx: Ctx;
  const date = futureDate();
  const book = async (startTime = '09:00', doc = () => ctx.docA, patient = () => ctx.p1) =>
    (await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: patient()._id, doctorId: doc()._id, appointmentDate: date, startTime, purpose: 'Checkup' }).expect(201)).body.data;
  const act = (verb: 'post' | 'patch' | 'delete', path: string, token: string, body?: object) => (request(app) as any)[verb](`/api/v1/appointments/${path}`).set(auth(token)).send(body);

  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); ctx = await bootstrap(app); });

  it('happy path SCHEDULED -> ARRIVED -> COMPLETED with timestamps', async () => {
    const a = await book();
    expect((await act('post', `${a._id}/arrive`, ctx.rec).expect(200)).body.data.status).toBe('ARRIVED');
    const done = await act('post', `${a._id}/complete`, ctx.docAToken, { consultationNotes: 'All good' }).expect(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', consultationNotes: 'All good' });
    const raw = await Appointment.findById(a._id).lean();
    expect(raw!.arrivedAt).toBeDefined();
    expect(raw!.completedAt).toBeDefined();
  });

  it('rejects every invalid transition with 409 INVALID_TRANSITION', async () => {
    const a = await book();
    const id = a._id;
    const bad = async (path: string, token: string, body?: object) => expect((await act('post', `${id}/${path}`, token, body).expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    await bad('complete', ctx.rec);                    // SCHEDULED -> COMPLETED skips ARRIVED
    await bad('complete', ctx.docAToken);
    await act('post', `${id}/arrive`, ctx.rec).expect(200);
    await bad('arrive', ctx.rec);                      // ARRIVED -> ARRIVED
    await act('post', `${id}/complete`, ctx.rec).expect(200);
    await bad('arrive', ctx.rec);                      // COMPLETED -> ARRIVED
    await bad('complete', ctx.rec);                    // COMPLETED -> COMPLETED
    await bad('cancel', ctx.rec, {});                  // COMPLETED -> CANCELLED
    await act('delete', id, ctx.rec).expect(409);

    const c = await book('09:30');
    await act('post', `${c._id}/cancel`, ctx.rec, {}).expect(200);
    await act('post', `${c._id}/arrive`, ctx.rec).expect(409);    // CANCELLED is terminal
    await act('post', `${c._id}/complete`, ctx.rec).expect(409);
    await act('post', `${c._id}/cancel`, ctx.rec, {}).expect(409);
    await act('patch', c._id, ctx.rec, { purpose: 'edit' }).expect(409);
  });

  it('DELETE logically cancels: record kept with who/when/why, audited, then not repeatable', async () => {
    const a = await book();
    const res = await act('delete', `${a._id}?reason=patient%20called`, ctx.rec).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
    const raw = await Appointment.findById(a._id).lean();
    expect(raw).not.toBeNull();
    expect(raw!.status).toBe('CANCELLED');
    expect(raw!.cancelReason).toBe('patient called');
    expect(raw!.cancelledAt).toBeDefined();
    expect(String(raw!.cancelledBy)).toBeTruthy();
    expect(await Appointment.countDocuments()).toBe(1);
    const log = await AuditLog.findOne({ action: 'APPOINTMENT_CANCELLED' }).lean();
    expect(log!.metadata).toMatchObject({ via: 'delete', previousStatus: 'SCHEDULED' });
    await act('delete', a._id, ctx.rec).expect(409);
    const list = await request(app).get(`/api/v1/appointments?status=CANCELLED`).set(auth(ctx.rec)).expect(200);
    expect(list.body.data).toHaveLength(1); // still listable
  });

  it('ARRIVED -> CANCELLED is allowed only with a reason', async () => {
    const a = await book();
    await act('post', `${a._id}/arrive`, ctx.rec).expect(200);
    await act('delete', a._id, ctx.rec).expect(422);
    await act('post', `${a._id}/cancel`, ctx.rec, {}).expect(422);
    const ok = await act('post', `${a._id}/cancel`, ctx.rec, { reason: 'left before consultation' }).expect(200);
    expect(ok.body.data.status).toBe('CANCELLED');
    expect((await AuditLog.findOne({ action: 'APPOINTMENT_CANCELLED' }).lean())!.metadata).toMatchObject({ previousStatus: 'ARRIVED' });
  });

  it('PATCH edits purpose/notes while SCHEDULED or ARRIVED; rescheduling only while SCHEDULED', async () => {
    const a = await book();
    await act('post', `${a._id}/arrive`, ctx.rec).expect(200);
    const ok = await act('patch', a._id, ctx.rec, { purpose: 'Follow-up', notes: 'bring reports' }).expect(200);
    expect(ok.body.data).toMatchObject({ purpose: 'Follow-up', notes: 'bring reports' });
    await act('patch', a._id, ctx.rec, { startTime: '09:30' }).expect(409);
    await act('post', `${a._id}/complete`, ctx.rec).expect(200);
    await act('patch', a._id, ctx.rec, { purpose: 'too late' }).expect(409);
  });

  it('enforces role and record-level permissions on every operation', async () => {
    const a = await book('09:00', () => ctx.docA);
    const b = await book('09:00', () => ctx.docB, () => ctx.p2);
    // doctors cannot book/edit/cancel/delete/arrive
    for (const [verb, path, body] of [['patch', a._id, { purpose: 'x' }], ['delete', a._id], ['post', `${a._id}/cancel`, {}], ['post', `${a._id}/arrive`]] as const)
      await act(verb as any, path, ctx.docAToken, body as any).expect(403);
    // admin is read-only
    for (const [verb, path, body] of [['patch', a._id, { purpose: 'x' }], ['delete', a._id], ['post', `${a._id}/arrive`], ['post', `${a._id}/complete`]] as const)
      await act(verb as any, path, ctx.admin, body as any).expect(403);
    // doctors can read/complete only their own records
    await act('post', `${a._id}/arrive`, ctx.rec).expect(200);
    await act('post', `${b._id}/arrive`, ctx.rec).expect(200);
    await act('post', `${b._id}/complete`, ctx.docAToken, {}).expect(404);
    await act('patch', `${b._id}/consultation`, ctx.docAToken, { consultationNotes: 'x' }).expect(404);
    expect((await Appointment.findById(b._id))!.status).toBe('ARRIVED');
    // receptionists may complete but not write clinical notes
    await act('post', `${b._id}/complete`, ctx.rec, { consultationNotes: 'sneaky' }).expect(403);
    await act('post', `${b._id}/complete`, ctx.rec, {}).expect(200);
    await act('post', `${a._id}/complete`, ctx.docAToken, {}).expect(200);
    // unauthenticated
    await request(app).delete(`/api/v1/appointments/${a._id}`).expect(401);
  });

  it('cancelled bookings stay visible to admins, and doctors only see their own cancelled ones', async () => {
    const a = await book('09:00', () => ctx.docA);
    const b = await book('09:00', () => ctx.docB, () => ctx.p2);
    await act('delete', a._id, ctx.rec).expect(200);
    await act('delete', b._id, ctx.rec).expect(200);
    expect((await request(app).get('/api/v1/appointments?status=CANCELLED').set(auth(ctx.admin))).body.data).toHaveLength(2);
    expect((await request(app).get('/api/v1/appointments?status=CANCELLED').set(auth(ctx.docAToken))).body.data.map((x: any) => x._id)).toEqual([a._id]);
  });
});
