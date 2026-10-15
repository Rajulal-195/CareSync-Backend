import bcrypt from 'bcrypt';
import request from 'supertest';
import { runSeed } from '../../scripts/seed';
import { createApp } from '../app';
import { Appointment } from '../models/Appointment';
import { Department } from '../models/Department';
import { Doctor } from '../models/Doctor';
import { DoctorSchedule } from '../models/DoctorSchedule';
import { Patient } from '../models/Patient';
import { User } from '../models/User';
import { generateSlots } from '../utils/time';
import { auth, clearDb, startDb, stopDb } from './helpers';

const app = createApp();
const OPTS = { adminEmail: 'Seed.Admin@Example.com', adminPassword: 'SeedAdm1nPassw0rd!', sampleData: true, bcryptRounds: 4, timezone: 'UTC' } as const;
const snapshot = async () => ({
  admins: await User.countDocuments({ role: 'SUPER_ADMIN' }), doctors: await Doctor.countDocuments(), doctorUsers: await User.countDocuments({ role: 'DOCTOR' }),
  receptionists: await User.countDocuments({ role: 'RECEPTIONIST' }), departments: await Department.countDocuments(), patients: await Patient.countDocuments(),
  schedules: await DoctorSchedule.countDocuments(), appointments: await Appointment.countDocuments(),
});

describe('seed script', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(clearDb);

  it('creates 1 admin, 3 departments, 3 doctors with schedules, 2 receptionists, 10 patients and sample appointments', async () => {
    const report = await runSeed(OPTS);
    expect(await snapshot()).toMatchObject({ admins: 1, doctors: 3, doctorUsers: 3, receptionists: 2, departments: 3, patients: 10, schedules: 3 });
    expect((await snapshot()).appointments).toBeGreaterThanOrEqual(6);
    expect(report.created).toMatchObject({ superAdmin: 1, doctors: 3, receptionists: 2, departments: 3, patients: 10, schedules: 3 });
  });

  it('takes the admin identity from the supplied credentials and stores only a bcrypt hash', async () => {
    await runSeed(OPTS);
    const admin = await User.findOne({ role: 'SUPER_ADMIN' }).select('+passwordHash');
    expect(admin!.email).toBe('seed.admin@example.com');
    expect(admin!.passwordHash).not.toContain('SeedAdm1nPassw0rd');
    expect(await bcrypt.compare(OPTS.adminPassword, admin!.passwordHash)).toBe(true);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'seed.admin@example.com', password: OPTS.adminPassword }).expect(200);
    expect(login.body.data.user.role).toBe('SUPER_ADMIN');
  });

  it('is idempotent: a second and third run create nothing and change nothing', async () => {
    const first = await runSeed(OPTS);
    const before = await snapshot();
    const hashBefore = (await User.findOne({ role: 'SUPER_ADMIN' }).select('+passwordHash'))!.passwordHash;
    const second = await runSeed({ ...OPTS, adminPassword: 'AnotherPassw0rd!2' }); // a different env password must NOT reset the admin
    await runSeed(OPTS);
    expect(await snapshot()).toEqual(before);
    expect(second.created).toEqual({});
    expect(second.generatedCredentials).toEqual([]);
    expect(first.generatedCredentials).toHaveLength(5); // 3 doctors + 2 receptionists
    expect((await User.findOne({ role: 'SUPER_ADMIN' }).select('+passwordHash'))!.passwordHash).toBe(hashBefore);
    expect(await Patient.distinct('patientId')).toHaveLength(10); // unique patient codes, none burned twice
  });

  it('does not overwrite schedules or users that were edited after seeding', async () => {
    await runSeed(OPTS);
    const doc = (await Doctor.findOne())!;
    await DoctorSchedule.updateOne({ doctor: doc._id }, { slotDuration: 45, sessions: [{ start: '10:00', end: '16:00' }], breaks: [] });
    await User.updateOne({ _id: doc.user }, { name: 'Renamed Doctor' });
    await runSeed(OPTS);
    expect((await DoctorSchedule.findOne({ doctor: doc._id }))!.slotDuration).toBe(45);
    expect((await User.findById(doc.user))!.name).toBe('Renamed Doctor');
  });

  it('generates per-run staff passwords that work, or uses SEED_STAFF_PASSWORD when given (nothing printed then)', async () => {
    const r1 = await runSeed(OPTS);
    const cred = r1.generatedCredentials[0];
    expect(cred.password.length).toBeGreaterThanOrEqual(12);
    expect(new Set(r1.generatedCredentials.map((c) => c.password)).size).toBe(1); // one shared password per run
    await request(app).post('/api/v1/auth/login').send(cred).expect(200);

    await clearDb();
    const r2 = await runSeed({ ...OPTS, staffPassword: 'Explicit-Staff-Passw0rd' });
    expect(r2.generatedCredentials).toEqual([]);
    await request(app).post('/api/v1/auth/login').send({ email: 'reception1@emr.example', password: 'Explicit-Staff-Passw0rd' }).expect(200);
    await request(app).post('/api/v1/auth/login').send({ email: 'reception1@emr.example', password: cred.password }).expect(401);

    await clearDb();
    const r3 = await runSeed(OPTS);
    expect(r3.generatedCredentials[0].password).not.toBe(cred.password); // random each run, never a constant
  });

  it('seeds schedules and appointments that obey the same slot rules as the API', async () => {
    await runSeed(OPTS);
    const schedules = await DoctorSchedule.find();
    expect(schedules.every((s) => s.timezone === 'UTC' && s.sessions.length === 2 && s.breaks.length === 1 && s.isActive)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    for (const a of await Appointment.find()) {
      const sched = schedules.find((s) => String(s.doctor) === String(a.doctor))!;
      expect(a.status).toBe('SCHEDULED');
      expect(a.appointmentDate > today).toBe(true);
      expect(a.purpose.startsWith('[Sample]')).toBe(true);
      expect(generateSlots(sched, a.appointmentDate).some((s) => s.startTime === a.startTime && s.endTime === a.endTime)).toBe(true);
      expect(String((await Doctor.findById(a.doctor))!.department)).toBe(String(a.department));
    }
    const admin = (await request(app).post('/api/v1/auth/login').send({ email: 'seed.admin@example.com', password: OPTS.adminPassword })).body.data.accessToken;
    const list = await request(app).get('/api/v1/appointments?limit=100').set(auth(admin)).expect(200);
    expect(list.body.meta.total).toBe((await snapshot()).appointments);
  });

  it('admin-only mode (sampleData=false) creates just the Super Admin', async () => {
    await runSeed({ ...OPTS, sampleData: false });
    expect(await snapshot()).toEqual({ admins: 1, doctors: 0, doctorUsers: 0, receptionists: 0, departments: 0, patients: 0, schedules: 0, appointments: 0 });
  });
});
