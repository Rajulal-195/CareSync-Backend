import request from 'supertest';
import { createApp } from '../app';
import { auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();
type Ctx = Awaited<ReturnType<typeof bootstrap>>;

describe('appointment list: search, filters, sorting, pagination', () => {
  let ctx: Ctx;
  let ids: string[];
  const [d1, d2, d3] = [futureDate(7), futureDate(8), futureDate(9)];
  const list = (qs: string, token = () => ctx.rec) => request(app).get(`/api/v1/appointments?${qs}`).set(auth(token()));
  const book = async (doc: any, patient: any, appointmentDate: string, startTime: string) =>
    (await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: patient._id, doctorId: doc._id, appointmentDate, startTime, purpose: 'Checkup' }).expect(201)).body.data._id as string;

  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => {
    await clearDb();
    ctx = await bootstrap(app);
    ids = [
      await book(ctx.docA, ctx.p1, d1, '09:00'), // 0
      await book(ctx.docA, ctx.p2, d2, '09:00'), // 1
      await book(ctx.docB, ctx.p1, d3, '09:00'), // 2
      await book(ctx.docB, ctx.p2, d1, '09:30'), // 3
    ];
    await request(app).post(`/api/v1/appointments/${ids[3]}/arrive`).set(auth(ctx.rec)).expect(200);
  });

  it('paginates with complete metadata', async () => {
    const p1 = await list('page=1&limit=3').expect(200);
    expect(p1.body).toMatchObject({ success: true, meta: { page: 1, limit: 3, total: 4, pages: 2, hasNextPage: true, hasPrevPage: false } });
    expect(p1.body.data).toHaveLength(3);
    const p2 = await list('page=2&limit=3').expect(200);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.meta).toMatchObject({ hasNextPage: false, hasPrevPage: true });
    expect((await list('page=3&limit=3').expect(200)).body.data).toHaveLength(0);
    const seen = [...p1.body.data, ...p2.body.data].map((a: any) => a._id);
    expect(new Set(seen).size).toBe(4); // pages never overlap
    await list('limit=101').expect(400);
    await list('page=0').expect(400);
    await list('limit=abc').expect(400);
  });

  it('sorts by allow-listed fields in both directions with a stable tie-break', async () => {
    const asc = (await list('sortBy=appointmentDate&sortOrder=asc').expect(200)).body.data.map((a: any) => `${a.appointmentDate} ${a.startTime}`);
    expect(asc).toEqual([`${d1} 09:00`, `${d1} 09:30`, `${d2} 09:00`, `${d3} 09:00`]);
    const desc = (await list('sortBy=appointmentDate&sortOrder=desc').expect(200)).body.data.map((a: any) => `${a.appointmentDate} ${a.startTime}`);
    expect(desc).toEqual([...asc].reverse());
    const byStart = (await list('sortBy=startTime&sortOrder=desc').expect(200)).body.data.map((a: any) => a.startTime);
    expect(byStart[0]).toBe('09:30');
    const meta = (await list('sortBy=createdAt&sortOrder=desc').expect(200)).body.meta;
    expect(meta).toMatchObject({ sortBy: 'createdAt', sortOrder: 'desc' });
    const newest = (await list('sortBy=createdAt&sortOrder=desc&limit=1').expect(200)).body.data[0]._id;
    expect(newest).toBe(ids[3]);
  });

  it('rejects sort fields outside the allow-list', async () => {
    await list('sortBy=passwordHash').expect(400);
    await list('sortBy=patient.name').expect(400);
    await list('sortBy=consultationNotes').expect(400);
    await list('sortOrder=sideways').expect(400);
  });

  it('filters by status (single and comma list) and rejects unknown statuses', async () => {
    expect((await list('status=ARRIVED').expect(200)).body.data.map((a: any) => a._id)).toEqual([ids[3]]);
    expect((await list('status=SCHEDULED').expect(200)).body.meta.total).toBe(3);
    expect((await list('status=SCHEDULED,ARRIVED').expect(200)).body.meta.total).toBe(4);
    expect((await list('status=CANCELLED').expect(200)).body.meta.total).toBe(0);
    await list('status=BOGUS').expect(400);
  });

  it('filters by date, date range, doctor and department', async () => {
    expect((await list(`date=${d1}`).expect(200)).body.meta.total).toBe(2);
    expect((await list(`dateFrom=${d2}&dateTo=${d3}`).expect(200)).body.meta.total).toBe(2);
    expect((await list(`dateFrom=${d2}`).expect(200)).body.meta.total).toBe(2);
    expect((await list(`dateTo=${d1}`).expect(200)).body.meta.total).toBe(2);
    await list(`dateFrom=${d3}&dateTo=${d1}`).expect(400);
    expect((await list(`doctorId=${ctx.docA._id}`).expect(200)).body.meta.total).toBe(2);
    expect((await list(`departmentId=${ctx.dept._id}`).expect(200)).body.meta.total).toBe(4);
    expect((await list(`patientId=${ctx.p1._id}`).expect(200)).body.meta.total).toBe(2);
    expect((await list(`doctorId=${ctx.docA._id}&status=SCHEDULED&dateFrom=${d2}`).expect(200)).body.data.map((a: any) => a._id)).toEqual([ids[1]]);
  });

  it('searches by patient name, patient ID and mobile (free text and explicit filters)', async () => {
    const total = async (qs: string) => (await list(qs).expect(200)).body.meta.total;
    expect(await total('q=pat one')).toBe(2);              // name, case-insensitive
    expect(await total('q=PT-000002')).toBe(2);            // patient code
    expect(await total('q=pt-000002')).toBe(2);            // ...case-insensitively
    expect(await total('q=9876543211')).toBe(2);           // mobile (p2)
    expect(await total('q=3210')).toBe(2);                 // partial mobile (p1)
    expect(await total('patientName=two')).toBe(2);
    expect(await total('patientCode=PT-000001')).toBe(2);
    expect(await total('mobile=9876543210')).toBe(2);
    expect(await total('q=nobody')).toBe(0);
    expect(await total('q=pat one&status=SCHEDULED&doctorId=' + ctx.docB._id)).toBe(1); // combined
    expect(await total('q=.*')).toBe(0);                   // regex metacharacters are literals
    await list('q=a').expect(400);                         // too short
    await list('patientCode=XX-1').expect(400);
  });

  it('returns a lean, minimal projection', async () => {
    const res = await list('limit=1').expect(200);
    const a = res.body.data[0];
    expect(Object.keys(a.patient).sort()).toEqual(['_id', 'mobile', 'name', 'patientId']);
    expect(a.consultationNotes).toBeUndefined();
    expect(a.__v).toBeUndefined();
    expect(a.doctor.user.name).toMatch(/^Dr /);
    expect(a.department.name).toBe('Cardiology');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|email/i);
  });

  it('keeps doctor scoping with search, filters and sorting', async () => {
    const res = await list(`q=pat&doctorId=${ctx.docB._id}&sortBy=startTime`, () => ctx.docAToken).expect(200);
    expect(res.body.data.every((a: any) => a.doctor._id === ctx.docA._id)).toBe(true);
    expect(res.body.meta.total).toBe(2);
    expect((await list('q=PT-000002', () => ctx.docAToken).expect(200)).body.meta.total).toBe(1);
  });

  it('refuses operator injection in query strings', async () => {
    await request(app).get('/api/v1/appointments?status[$ne]=CANCELLED').set(auth(ctx.rec)).expect(400);
    await request(app).get('/api/v1/appointments?doctorId[$ne]=x').set(auth(ctx.rec)).expect(400);
    await request(app).get('/api/v1/appointments?q[$regex]=.*').set(auth(ctx.rec)).expect(400);
  });

  it('patient list supports sort + pagination metadata too', async () => {
    const res = await request(app).get('/api/v1/patients?sortBy=name&sortOrder=desc&limit=1').set(auth(ctx.rec)).expect(200);
    expect(res.body.data[0].name).toBe('Pat Two');
    expect(res.body.meta).toMatchObject({ total: 2, pages: 2, hasNextPage: true, sortBy: 'name', sortOrder: 'desc' });
    await request(app).get('/api/v1/patients?sortBy=mobile').set(auth(ctx.rec)).expect(400);
  });
});
