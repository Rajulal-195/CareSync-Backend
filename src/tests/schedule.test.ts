import request from 'supertest';
import { createApp } from '../app';
import { AuditLog } from '../models/AuditLog';
import { SCHEDULE, auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('doctor schedule management', () => {
  let ctx: Ctx;
  const date = futureDate();
  const put = (body: object, token = () => ctx.admin) => request(app).put(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(token())).send(body);
  const patch = (body: object) => request(app).patch(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(ctx.admin)).send(body);
  const bookNine = async () =>
    (await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: date, startTime: '09:00', purpose: 'x' }).expect(201)).body.data;

  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); ctx = await bootstrap(app); });

  it('only SUPER_ADMIN can write schedules; receptionist can read', async () => {
    await put(SCHEDULE, () => ctx.rec).expect(403);
    await put(SCHEDULE, () => ctx.docAToken).expect(403);
    await request(app).get(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(ctx.rec)).expect(200);
    expect(await AuditLog.countDocuments({ action: 'SCHEDULE_CREATED' })).toBe(2); // bootstrap created two
    await put(SCHEDULE).expect(200);
    expect(await AuditLog.countDocuments({ action: 'SCHEDULE_UPDATED' })).toBe(1);
  });

  it.each([
    ['unknown timezone', { timezone: 'Mars/Base' }],
    ['zero slot duration', { slotDuration: 0 }],
    ['negative slot duration', { slotDuration: -30 }],
    ['non-integer slot duration', { slotDuration: 12.5 }],
    ['session end before start', { sessions: [{ start: '12:00', end: '09:00' }] }],
    ['session with equal start/end', { sessions: [{ start: '09:00', end: '09:00' }] }],
    ['malformed time', { sessions: [{ start: '9am', end: '12:00' }] }],
    ['overlapping sessions', { sessions: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }],
    ['break outside any session', { breaks: [{ start: '12:30', end: '13:00' }] }],
    ['break straddling two sessions', { sessions: [{ start: '09:00', end: '12:00' }, { start: '12:00', end: '15:00' }], breaks: [{ start: '11:45', end: '12:15' }] }],
    ['overlapping breaks', { breaks: [{ start: '10:00', end: '10:30' }, { start: '10:15', end: '10:45' }] }],
    ['duplicate working days', { workingDays: [1, 1] }],
    ['no working days', { workingDays: [] }],
    ['slot longer than every session', { slotDuration: 240, sessions: [{ start: '09:00', end: '10:00' }], breaks: [] }],
    ['unknown field', { surprise: true }],
  ])('rejects %s', async (_name, override) => {
    await put({ ...SCHEDULE, ...override }).expect(400);
  });

  it('PATCH merges onto the stored schedule and re-validates', async () => {
    await patch({ slotDuration: 15 }).expect(200);
    const s = (await request(app).get(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(ctx.admin)).expect(200)).body.data;
    expect(s.slotDuration).toBe(15);
    expect(s.sessions).toHaveLength(2);
    expect(s.breaks).toHaveLength(1);
    expect(s.timezone).toBe('UTC');
    await patch({ breaks: [{ start: '13:00', end: '13:15' }] }).expect(400); // break now outside every session
    await patch({}).expect(400);
  });

  it('blocks edits that would silently invalidate upcoming appointments, listing them', async () => {
    const appt = await bookNine();
    const res = await patch({ slotDuration: 45 }).expect(409);
    expect(res.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(res.body.error.details.count).toBe(1);
    expect(res.body.error.details.appointments[0]).toMatchObject({ id: appt._id, startTime: '09:00', reason: 'no longer matches a generated slot' });
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    await patch({ workingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== dow) }).expect(409);
    await patch({ sessions: [{ start: '10:00', end: '12:00' }] }).expect(409);        // 09:00 no longer inside a session
    await patch({ breaks: [{ start: '09:00', end: '09:15' }] }).expect(409);          // break covers the booked slot
    await put({ ...SCHEDULE, isActive: false }).expect(409);                          // deactivation
    await patch({ timezone: 'Asia/Kolkata' }).expect(409);                            // wall-clock would shift
    const stored = (await request(app).get(`/api/v1/doctors/${ctx.docA._id}/schedule`).set(auth(ctx.admin))).body.data;
    expect(stored.slotDuration).toBe(30); // nothing was applied
    expect(stored.isActive).toBe(true);
  });

  it('allows compatible edits and edits once conflicting appointments are cancelled or completed', async () => {
    const appt = await bookNine();
    await patch({ sessions: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] }).expect(200); // still fits 09:00-09:30
    await patch({ slotDuration: 15 }).expect(409); // 09:00-09:30 is not a 15-minute slot
    await request(app).delete(`/api/v1/appointments/${appt._id}`).set(auth(ctx.rec)).expect(200);
    await patch({ slotDuration: 45 }).expect(200);
    await put({ ...SCHEDULE, isActive: false }).expect(200);
    await put({ ...SCHEDULE, timezone: 'Asia/Kolkata' }).expect(200);
  });

  it('uses the doctor-local wall clock consistently (schedule timezone is the source of truth)', async () => {
    await put({ ...SCHEDULE, timezone: 'Asia/Kolkata' }).expect(200);
    const res = await request(app).get(`/api/v1/slots?doctorId=${ctx.docA._id}&date=${date}`).set(auth(ctx.rec)).expect(200);
    expect(res.body.data[0].timezone).toBe('Asia/Kolkata');
    expect(res.body.data[0].slots[0].startTime).toBe('09:00'); // wall-clock in the doctor's zone, not shifted to server/UTC time
  });
});
