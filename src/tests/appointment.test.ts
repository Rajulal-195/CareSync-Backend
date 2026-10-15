import request from 'supertest';
import { createApp } from '../app';
import { Appointment } from '../models/Appointment';
import { nowInTimezone } from '../utils/time';
import { SCHEDULE, auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('appointments', () => {
  let ctx: Ctx;
  const date = futureDate();
  const body = (startTime: string, patient = () => ctx.p1) => ({ patientId: patient()._id, doctorId: ctx.docA._id, appointmentDate: date, startTime, purpose: 'Consult' });
  const book = (b: object, token = () => ctx.rec) => request(app).post('/api/v1/appointments').set(auth(token())).send(b);

  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); ctx = await bootstrap(app); });

  it('partial unique index is built with the active-status definition', async () => {
    const idx = (await Appointment.collection.indexes()).find((i) => i.name === 'uniq_active_doctor_slot')!;
    expect(idx.unique).toBe(true);
    expect(idx.partialFilterExpression).toEqual({ status: { $in: ['SCHEDULED', 'ARRIVED', 'COMPLETED'] } });
  });

  it('books a slot, then rejects a second booking of the same doctor/date/slot', async () => {
    const first = await book(body('09:00')).expect(201);
    expect(first.body.data.endTime).toBe('09:30');
    await book(body('09:00', () => ctx.p2)).expect(409);
  });

  it('rejects times that are not generated slots, breaks, and past slots', async () => {
    await book(body('09:10')).expect(422);   // not on the 30-minute grid
    await book(body('10:30')).expect(422);   // overlaps the 10:30-10:45 break
    await book(body('12:30')).expect(422);   // between sessions
    await book({ ...body('09:00'), appointmentDate: '2020-01-01' }).expect(422);
    await book({ ...body('09:00'), extra: 1 }).expect(400);
  });

  it('cancelled appointments free the slot for rebooking', async () => {
    const a = (await book(body('09:30')).expect(201)).body.data;
    await request(app).post(`/api/v1/appointments/${a._id}/cancel`).set(auth(ctx.rec)).send({ reason: 'patient request' }).expect(200);
    await book(body('09:30', () => ctx.p2)).expect(201);
    await request(app).post(`/api/v1/appointments/${a._id}/cancel`).set(auth(ctx.rec)).send({}).expect(409); // already cancelled
  });

  it('10 concurrent bookings of one slot produce exactly one success', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => book(body('11:00'))));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(await Appointment.countDocuments({ doctor: ctx.docA._id, appointmentDate: date, startTime: '11:00' })).toBe(1);
  });

  it('database index alone blocks duplicates that bypass the service checks', async () => {
    const a = (await book(body('14:00')).expect(201)).body.data;
    const dup = { ...(await Appointment.findById(a._id).lean())! } as any;
    delete dup._id;
    await expect(Appointment.collection.insertOne(dup)).rejects.toMatchObject({ code: 11000 });
  });

  it('reschedules, and refuses to move onto a taken slot', async () => {
    const a = (await book(body('15:00')).expect(201)).body.data;
    await book(body('15:30', () => ctx.p2)).expect(201);
    await request(app).patch(`/api/v1/appointments/${a._id}`).set(auth(ctx.rec)).send({ startTime: '15:30' }).expect(409);
    const moved = await request(app).patch(`/api/v1/appointments/${a._id}`).set(auth(ctx.rec)).send({ startTime: '16:00', notes: 'moved' }).expect(200);
    expect(moved.body.data.startTime).toBe('16:00');
    await request(app).patch(`/api/v1/appointments/${a._id}`).set(auth(ctx.rec)).send({ startTime: '15:00' }).expect(200); // old slot is free again
  });

  it('enforces the status workflow: arrive -> notes -> complete', async () => {
    const a = (await book(body('09:00')).expect(201)).body.data;
    const id = a._id;
    await request(app).patch(`/api/v1/appointments/${id}/consultation`).set(auth(ctx.docAToken)).send({ consultationNotes: 'early' }).expect(409); // not arrived yet
    await request(app).post(`/api/v1/appointments/${id}/arrive`).set(auth(ctx.rec)).expect(200);
    await request(app).post(`/api/v1/appointments/${id}/arrive`).set(auth(ctx.rec)).expect(409);
    const done = await request(app).patch(`/api/v1/appointments/${id}/consultation`).set(auth(ctx.docAToken)).send({ consultationNotes: 'BP normal', complete: true }).expect(200);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.consultationNotes).toBe('BP normal');
    await request(app).post(`/api/v1/appointments/${id}/cancel`).set(auth(ctx.rec)).send({}).expect(409); // completed can't be cancelled
    await book(body('09:00', () => ctx.p2)).expect(409); // completed still occupies the slot
  });

  it('slots endpoint reflects availability', async () => {
    await book(body('09:00')).expect(201);
    const res = await request(app).get(`/api/v1/doctors/${ctx.docA._id}/slots?date=${date}`).set(auth(ctx.rec)).expect(200);
    const slots = res.body.data.slots;
    expect(slots.find((s: any) => s.startTime === '09:00').available).toBe(false);
    expect(slots.find((s: any) => s.startTime === '09:30').available).toBe(true);
    expect(slots.some((s: any) => s.startTime === '10:30')).toBe(false);
  });

  it('patient search and id generation', async () => {
    expect(ctx.p1.patientId).toBe('PT-000001');
    expect(ctx.p2.patientId).toBe('PT-000002');
    const r = await request(app).get('/api/v1/patients?q=9876543211').set(auth(ctx.rec)).expect(200);
    expect(r.body.data).toHaveLength(1);
    const regexInjection = await request(app).get('/api/v1/patients?q=.*').set(auth(ctx.rec)).expect(200);
    expect(regexInjection.body.data).toHaveLength(0); // escaped, treated literally
  });

  it("rejects a slot that has already started today in the doctor's own timezone", async () => {
    await request(app).put(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(ctx.admin)).send({ ...SCHEDULE, sessions: [{ start: '00:00', end: '23:30' }], breaks: [] }).expect(200);
    const today = nowInTimezone('UTC').date;
    const res = await book({ ...body('00:00'), appointmentDate: today }).expect(422); // 00:00 today is in the past except for one minute a day
    expect(res.body.message).toMatch(/past/i);
    await book({ ...body('00:00'), appointmentDate: '2020-01-01' }).expect(422);       // and any earlier date
  });
});
