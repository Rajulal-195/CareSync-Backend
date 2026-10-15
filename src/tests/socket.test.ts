import http from 'http';
import { AddressInfo } from 'net';
import { io as client, Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../app';
import { initSocket } from '../sockets';
import { auth, bootstrap, clearDb, futureDate, startDb, stopDb } from './helpers';

const app = createApp();

describe('socket.io authorization', () => {
  let server: http.Server;
  let url: string;
  const sockets: Socket[] = [];
  const connect = (token?: string) => {
    const s = client(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return s;
  };

  beforeAll(async () => {
    await startDb();
    server = http.createServer(app);
    initSocket(server);
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { sockets.forEach((s) => s.close()); server.close(); await stopDb(); });
  beforeEach(clearDb);

  it('rejects unauthenticated connections', async () => {
    const s = connect();
    const err = await new Promise<Error>((res) => s.on('connect_error', res));
    expect(err.message).toBe('unauthorized');
  });

  it('delivers appointment events only to staff roles and the assigned doctor', async () => {
    const ctx = await bootstrap(app);
    const a = connect(ctx.docAToken);
    const b = connect(ctx.docBToken);
    const r = connect(ctx.rec);
    await Promise.all([a, b, r].map((s) => new Promise<void>((res) => s.on('connect', () => res()))));

    const gotA = new Promise<any>((res) => a.on('appointment:created', res));
    const gotR = new Promise<any>((res) => r.on('appointment:created', res));
    let bReceived = false;
    b.on('appointment:created', () => { bReceived = true; });

    await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: futureDate(), startTime: '09:00', purpose: 'x' }).expect(201);

    const [evA, evR] = await Promise.all([gotA, gotR]);
    expect(evA.doctorId).toBe(ctx.docA._id);
    expect(evR.status).toBe('SCHEDULED');
    expect(evA.patient).toBeUndefined(); // payload carries no patient data
    await new Promise((r2) => setTimeout(r2, 300));
    expect(bReceived).toBe(false);
  });
});

describe('socket.io events and reconnect contract', () => {
  let server: http.Server;
  let url: string;
  const sockets: Socket[] = [];
  const connect = (token: string) => {
    const s = client(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return s;
  };
  const once = <T = any>(s: Socket, ev: string) => new Promise<T>((res) => s.once(ev, res));

  beforeAll(async () => {
    await startDb();
    server = http.createServer(app);
    initSocket(server);
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { sockets.forEach((s) => s.close()); server.close(); await stopDb(); });
  beforeEach(clearDb);

  it('emits sync:required on every connection so clients refetch after (re)connecting', async () => {
    const ctx = await bootstrap(app);
    const s = connect(ctx.rec);
    const ev = await once(s, 'sync:required');
    expect(new Date(ev.serverTime).getTime()).not.toBeNaN();
  });

  it('broadcasts created / updated / status-changed / cancelled / slot:updated after persistence, to the right rooms', async () => {
    const ctx = await bootstrap(app);
    const date = futureDate();
    const rec = connect(ctx.rec);
    const docA = connect(ctx.docAToken);
    const docB = connect(ctx.docBToken);
    await Promise.all([rec, docA, docB].map((s) => once(s, 'connect')));

    const received: Record<string, string[]> = { rec: [], docA: [], docB: [] };
    for (const [name, s] of [['rec', rec], ['docA', docA], ['docB', docB]] as const)
      for (const ev of ['appointment:created', 'appointment:updated', 'appointment:status-changed', 'appointment:cancelled', 'slot:updated']) s.on(ev, () => received[name].push(ev));

    const created = once(docA, 'appointment:created');
    const slot = once(rec, 'slot:updated');
    const res = await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: date, startTime: '09:00', purpose: 'x' }).expect(201);
    const id = res.body.data._id;
    const [c, sl] = await Promise.all([created, slot]);
    expect(c).toMatchObject({ id, doctorId: ctx.docA._id, status: 'SCHEDULED', appointmentDate: date, startTime: '09:00' });
    expect(Object.keys(c).sort()).toEqual(['appointmentDate', 'at', 'doctorId', 'id', 'startTime', 'status']); // minimal payload: no patient data
    expect(sl).toMatchObject({ doctorId: ctx.docA._id, appointmentDate: date });

    const changed = once(docA, 'appointment:status-changed');
    await request(app).post(`/api/v1/appointments/${id}/arrive`).set(auth(ctx.rec)).expect(200);
    expect(await changed).toMatchObject({ status: 'ARRIVED', previousStatus: 'SCHEDULED' });

    const cancelled = once(rec, 'appointment:cancelled');
    await request(app).post(`/api/v1/appointments/${id}/cancel`).set(auth(ctx.rec)).send({ reason: 'left' }).expect(200);
    expect(await cancelled).toMatchObject({ status: 'CANCELLED' });

    await new Promise((r) => setTimeout(r, 300));
    expect(received.docB).toEqual([]);                          // other doctor sees nothing
    expect(received.docA).not.toContain('slot:updated');        // doctors don't receive slot updates
    expect(received.rec).toEqual(expect.arrayContaining(['appointment:created', 'slot:updated', 'appointment:status-changed', 'appointment:cancelled']));
  });

  it('does not broadcast when the write fails (slot conflict)', async () => {
    const ctx = await bootstrap(app);
    const date = futureDate();
    const body = { patientId: ctx.p1._id, doctorId: ctx.docA._id, appointmentDate: date, startTime: '09:00', purpose: 'x' };
    await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send(body).expect(201);
    const rec = connect(ctx.rec);
    await once(rec, 'connect');
    let events = 0;
    for (const ev of ['appointment:created', 'slot:updated']) rec.on(ev, () => { events++; });
    await request(app).post('/api/v1/appointments').set(auth(ctx.rec)).send({ ...body, patientId: ctx.p2._id }).expect(409);
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toBe(0);
  });
});
