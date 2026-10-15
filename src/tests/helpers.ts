import bcrypt from 'bcrypt';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { User } from '../models/User';

let mongod: MongoMemoryReplSet;

/** Call AFTER importing the app so every model is registered, then indexes (incl. the partial unique one) are built. */
export async function startDb() {
  // Single-node replica set so multi-document transactions (new patient + appointment) run for real.
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.14' } });
  await mongoose.connect(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}
export async function stopDb() {
  await mongoose.disconnect();
  await mongod.stop();
}
export async function clearDb() {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
}

export const PW = 'Str0ngPassw0rd!';
export const ADMIN = { email: 'admin@example.com', password: PW };
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
export const futureDate = (days = 7) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

export async function seedAdmin() {
  return User.create({ name: 'Admin', email: ADMIN.email, role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(ADMIN.password, 4) });
}
export async function loginAs(app: Express, email: string, password = PW) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return res.body.data.accessToken as string;
}
export function cookieValue(res: request.Response, name: string): string {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${name}=`));
  return raw!.split(';')[0].slice(name.length + 1);
}

export const SCHEDULE = {
  timezone: 'UTC',
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  sessions: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '17:00' }],
  slotDuration: 30,
  breaks: [{ start: '10:30', end: '10:45' }],
};

/** Creates admin, receptionist, one department, two scheduled doctors and two patients via the real API. */
export async function bootstrap(app: Express) {
  await seedAdmin();
  const admin = await loginAs(app, ADMIN.email);
  const dept = (await request(app).post('/api/v1/departments').set(auth(admin)).send({ name: 'Cardiology' }).expect(201)).body.data;
  await request(app).post('/api/v1/receptionists').set(auth(admin)).send({ name: 'Rita Reception', email: 'rita@example.com', password: PW }).expect(201);
  const mkDoc = async (n: string) => {
    const d = (await request(app).post('/api/v1/doctors').set(auth(admin)).send({ name: `Dr ${n}`, email: `${n}@example.com`, password: PW, departmentId: dept._id, specialization: 'Cardiology' }).expect(201)).body.data;
    await request(app).put(`/api/v1/doctors/${d._id}/schedule`).set(auth(admin)).send(SCHEDULE).expect(200);
    return d;
  };
  const docA = await mkDoc('alice');
  const docB = await mkDoc('bob');
  const rec = await loginAs(app, 'rita@example.com');
  const mkPat = async (n: string, mobile: string) =>
    (await request(app).post('/api/v1/patients').set(auth(rec)).send({ name: n, mobile }).expect(201)).body.data;
  const p1 = await mkPat('Pat One', '9876543210');
  const p2 = await mkPat('Pat Two', '9876543211');
  return { admin, rec, dept, docA, docB, p1, p2, docAToken: await loginAs(app, 'alice@example.com'), docBToken: await loginAs(app, 'bob@example.com') };
}
