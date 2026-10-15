import request from 'supertest';
import { createApp } from '../app';
import { Appointment } from '../models/Appointment';
import { AuditLog } from '../models/AuditLog';
import { Patient } from '../models/Patient';
import { auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('booking: patient search, new patient, concurrency', () => {
  let ctx: Ctx;
  const date = futureDate();
  const base = (startTime: string) => ({ doctorId: ctx.docA._id, appointmentDate: date, startTime, purpose: 'Consult' });
  const bookNew = (startTime: string, mobile = '9000000001') => request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...base(startTime), newPatient: { name: 'Walk In', mobile } });

  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); ctx = await bootstrap(app); });

  it('finds existing patients by patientId, mobile or name (case-insensitive)', async () => {
    const find = async (q: string) => (await request(app).get(`/api/v1/patients?q=${encodeURIComponent(q)}`).set(auth(ctx.rec)).expect(200)).body.data;
    expect((await find('PT-000001'))[0]._id).toBe(ctx.p1._id);
    expect((await find('9876543211'))[0]._id).toBe(ctx.p2._id);
    expect((await find('pat two'))[0]._id).toBe(ctx.p2._id);
    expect(await find('nobody here')).toHaveLength(0);
  });

  it('books an existing patient and returns refreshed availability', async () => {
    const res = await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...base('09:00'), patientId: ctx.p1._id }).expect(201);
    expect(res.body.data).toMatchObject({ status: 'SCHEDULED', startTime: '09:00', endTime: '09:30' });
    expect(res.body.data.department.name).toBe('Cardiology');
    expect(res.body.meta.availability.slots.find((s: any) => s.startTime === '09:00').status).toBe('BOOKED');
  });

  it('creates a new patient and the appointment together', async () => {
    const before = await Patient.countDocuments();
    const res = await bookNew('09:00').expect(201);
    expect(res.body.data.patient.patientId).toMatch(/^PT-\d{6}$/);
    expect(res.body.data.patient.name).toBe('Walk In');
    expect(await Patient.countDocuments()).toBe(before + 1);
    expect(await AuditLog.countDocuments({ action: 'PATIENT_REGISTERED' })).toBe(3); // 2 from bootstrap + this one
  });

  it('leaves no orphan patient when the slot is taken (transaction rolled back)', async () => {
    await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...base('09:00'), patientId: ctx.p1._id }).expect(201);
    const before = await Patient.countDocuments();
    await bookNew('09:00').expect(409);
    expect(await Patient.countDocuments()).toBe(before);
  });

  it('requires exactly one of patientId / newPatient and a valid new patient', async () => {
    const post = (b: object) => request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...base('09:00'), ...b });
    await post({}).expect(400);
    await post({ patientId: ctx.p1._id, newPatient: { name: 'X Y', mobile: '9000000002' } }).expect(400);
    await post({ newPatient: { name: 'X Y', mobile: 'abc' } }).expect(400);
    await post({ patientId: 'a'.repeat(24) }).expect(404);
    expect(await Appointment.countDocuments()).toBe(0);
  });

  it('CONCURRENCY: 10 simultaneous bookings of one doctor/date/start -> exactly one 201, rest 409', async () => {
    const patients = [ctx.p1._id, ctx.p2._id];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...base('11:00'), patientId: patients[i % 2] })));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(await Appointment.countDocuments({ doctor: ctx.docA._id, appointmentDate: date, startTime: '11:00' })).toBe(1);
  });

  it('CONCURRENCY with new patients: exactly one booking AND exactly one new patient survive', async () => {
    const before = await Patient.countDocuments();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => bookNew('11:30', `90000001${String(i).padStart(2, '0')}`)));
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    expect(await Appointment.countDocuments({ doctor: ctx.docA._id, appointmentDate: date, startTime: '11:30' })).toBe(1);
    expect(await Patient.countDocuments()).toBe(before + 1); // the 9 losers rolled back their patients
  });

  it('a cancelled slot can be booked again, concurrently still exactly once', async () => {
    const first = await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...base('14:00'), patientId: ctx.p1._id }).expect(201);
    await request(app).delete(`/api/v1/appointments/${first.body.data._id}`).set(auth(ctx.rec)).expect(200);
    const results = await Promise.all(Array.from({ length: 6 }, () => request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...base('14:00'), patientId: ctx.p2._id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await Appointment.countDocuments({ doctor: ctx.docA._id, appointmentDate: date, startTime: '14:00' })).toBe(2); // cancelled history + live booking
  });
});
