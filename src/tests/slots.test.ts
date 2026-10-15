import request from 'supertest';
import { createApp } from '../app';
import { nowInTimezone } from '../utils/time';
import { SCHEDULE, auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('GET /slots', () => {
  let ctx: Ctx;
  const date = futureDate();
  const get = (qs: string, token = () => ctx.rec) => request(app).get(`/api/v1/slots?${qs}`).set(auth(token()));
  const putSchedule = (doc: any, body: object) => request(app).put(`/api/v1/doctors/${doc._id}/schedule`).set(auth(ctx.admin)).send({ ...SCHEDULE, ...body });

  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); ctx = await bootstrap(app); });

  it('generates slots from sessions, honouring breaks and slot duration', async () => {
    const res = await get(`doctorId=${ctx.docA._id}&date=${date}`).expect(200);
    expect(res.body.data).toHaveLength(1);
    const { slots, timezone, slotDuration } = res.body.data[0];
    expect(timezone).toBe('UTC');
    expect(slotDuration).toBe(30);
    expect(slots).toHaveLength(11); // 09:00-12:00 minus the 10:30 slot (break) = 5, plus 14:00-17:00 = 6
    expect(slots[0]).toMatchObject({ startTime: '09:00', endTime: '09:30', status: 'AVAILABLE', available: true });
    expect(slots.some((s: any) => s.startTime === '10:30')).toBe(false);
    expect(slots.some((s: any) => s.startTime === '12:00' || s.startTime === '13:00')).toBe(false);
    expect(slots[slots.length - 1].endTime).toBe('17:00');
  });

  it('filters by department and returns every active doctor in it', async () => {
    const res = await get(`departmentId=${ctx.dept._id}&date=${date}`).expect(200);
    expect(res.body.data.map((d: any) => d.doctorId).sort()).toEqual([ctx.docA._id, ctx.docB._id].sort());
  });

  it('returns BOOKED slots alongside AVAILABLE ones, and frees them on cancel', async () => {
    const booked = await request(app).post('/api/v1/appointments').set(auth(ctx.rec))
      .send({ patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: date, startTime: '09:00', purpose: 'x' }).expect(201);
    const slotsOf = async (doc: any) => (await get(`doctorId=${doc._id}&date=${date}`).expect(200)).body.data[0].slots;
    const a = await slotsOf(ctx.docA);
    expect(a.find((s: any) => s.startTime === '09:00')).toMatchObject({ status: 'BOOKED', available: false });
    expect(a.find((s: any) => s.startTime === '09:30').status).toBe('AVAILABLE');
    expect((await slotsOf(ctx.docB)).find((s: any) => s.startTime === '09:00').status).toBe('AVAILABLE'); // other doctor unaffected
    await request(app).delete(`/api/v1/appointments/${booked.body.data._id}`).set(auth(ctx.rec)).expect(200);
    expect((await slotsOf(ctx.docA)).find((s: any) => s.startTime === '09:00').status).toBe('AVAILABLE');
  });

  it('returns no slots for past dates', async () => {
    const res = await get(`departmentId=${ctx.dept._id}&date=2020-01-01`).expect(200);
    expect(res.body.data.every((d: any) => d.slots.length === 0)).toBe(true);
  });

  it('returns no slots on non-working days and omits doctors with inactive schedules', async () => {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    await putSchedule(ctx.docA, { workingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== dow) }).expect(200);
    expect((await get(`doctorId=${ctx.docA._id}&date=${date}`).expect(200)).body.data[0].slots).toEqual([]);
    await putSchedule(ctx.docB, { isActive: false }).expect(200);
    const dept = await get(`departmentId=${ctx.dept._id}&date=${date}`).expect(200);
    expect(dept.body.data.map((d: any) => d.doctorId)).toEqual([ctx.docA._id]);
    await get(`doctorId=${ctx.docB._id}&date=${date}`).expect(404);
  });

  it("excludes elapsed times 'today' in each doctor's own timezone", async () => {
    const fullDay = { sessions: [{ start: '00:00', end: '23:59' }], breaks: [] };
    for (const [doc, tz] of [[ctx.docA, 'Pacific/Kiritimati'], [ctx.docB, 'Pacific/Pago_Pago']] as const) {
      await putSchedule(doc, { ...fullDay, timezone: tz }).expect(200);
      const before = nowInTimezone(tz);
      const res = await get(`doctorId=${doc._id}&date=${before.date}`).expect(200);
      const slots = res.body.data[0].slots;
      expect(res.body.data[0].timezone).toBe(tz);
      expect(slots.every((s: any) => s.startTime > before.time)).toBe(true);
    }
  });

  it('validates input and enforces roles', async () => {
    await get(`doctorId=${ctx.docA._id}`).expect(400);                       // date required
    await get(`date=${date}&doctorId=nope`).expect(400);
    await get('date=2026-02-31').expect(400);                                // impossible date
    await get(`date=${date}&doctorId=${'a'.repeat(24)}`).expect(404);
    await get(`date=${date}`, () => ctx.docAToken).expect(403);
    await request(app).get(`/api/v1/slots?date=${date}`).expect(401);
    await get(`date=${date}`, () => ctx.admin).expect(200);
  });
});
