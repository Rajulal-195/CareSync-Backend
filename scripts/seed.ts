/**
 * Idempotent seed: 1 Super Admin, 3 departments, 3 doctors (+schedules), 2 receptionists, 10 patients, sample appointments.
 * Safe to run repeatedly: every record is looked up by a natural key first and only created when missing; existing
 * users/schedules are never modified (no password resets, no overwritten edits).
 *
 * Credentials: the admin comes ONLY from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Seeded staff use SEED_STAFF_PASSWORD, or a
 * random password generated per run and printed once for newly created users (outside production only).
 * Nothing is hardcoded; in production sample data additionally needs SEED_SAMPLE_DATA=true and SEED_STAFF_PASSWORD.
 */
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { connectDb, disconnectDb } from '../src/config/db';
import { env, isProd } from '../src/config/env';
import { Appointment } from '../src/models/Appointment';
import { Department } from '../src/models/Department';
import { Doctor } from '../src/models/Doctor';
import { DoctorSchedule } from '../src/models/DoctorSchedule';
import { Patient } from '../src/models/Patient';
import { User } from '../src/models/User';
import { nextPatientId } from '../src/services/patient.service';
import { generateSlots, nowInTimezone } from '../src/utils/time';

export interface SeedOptions {
  adminEmail: string;
  adminPassword: string;
  adminName?: string;
  staffPassword?: string; // generated when omitted (non-production only)
  sampleData: boolean;
  timezone?: string; // schedule timezone, defaults to APP_TIMEZONE
  bcryptRounds?: number;
  log?: (msg: string) => void;
}
export interface SeedReport {
  created: Record<string, number>;
  existing: Record<string, number>;
  generatedCredentials: { email: string; password: string }[]; // only for users created in THIS run with a generated password
}

const DEPARTMENTS = [
  { name: 'Cardiology', description: 'Heart and vascular care' },
  { name: 'Pediatrics', description: 'Child health' },
  { name: 'Orthopedics', description: 'Bones, joints and muscles' },
];
const DOCTORS = [
  { name: 'Dr. Asha Mehta', email: 'asha.mehta@emr.example', dept: 'Cardiology', specialization: 'Interventional Cardiology', fee: 800, slot: 30, room: 'C-101' },
  { name: 'Dr. Rohan Verma', email: 'rohan.verma@emr.example', dept: 'Pediatrics', specialization: 'General Pediatrics', fee: 500, slot: 20, room: 'P-204' },
  { name: 'Dr. Meera Iyer', email: 'meera.iyer@emr.example', dept: 'Orthopedics', specialization: 'Sports Medicine', fee: 700, slot: 30, room: 'O-310' },
];
const RECEPTIONISTS = [
  { name: 'Riya Sharma', email: 'reception1@emr.example' },
  { name: 'Kabir Singh', email: 'reception2@emr.example' },
];
const PATIENTS = [
  ['Aarav Patel', '9000000101', 'MALE', '1988-03-14'], ['Diya Nair', '9000000102', 'FEMALE', '1992-07-02'],
  ['Vihaan Rao', '9000000103', 'MALE', '2015-11-23'], ['Anaya Gupta', '9000000104', 'FEMALE', '2018-05-09'],
  ['Kavya Reddy', '9000000105', 'FEMALE', '1975-01-30'], ['Arjun Kapoor', '9000000106', 'MALE', '1969-09-18'],
  ['Ishita Joshi', '9000000107', 'FEMALE', '2001-12-05'], ['Rahul Desai', '9000000108', 'MALE', '1995-04-27'],
  ['Neha Bansal', '9000000109', 'FEMALE', '1983-08-11'], ['Sameer Khan', '9000000110', 'OTHER', '1990-06-21'],
] as const;
const PURPOSES = ['General checkup', 'Follow-up visit', 'New symptoms', 'Report review'];
const SAMPLE_TAG = '[Sample] ';

const randomPassword = () => `Sd${randomBytes(9).toString('base64url')}9a`; // >= 12 chars, letters + digit

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function runSeed(o: SeedOptions): Promise<SeedReport> {
  const log = o.log ?? (() => undefined);
  const rounds = o.bcryptRounds ?? env.BCRYPT_ROUNDS;
  const tz = o.timezone ?? env.APP_TIMEZONE;
  const report: SeedReport = { created: {}, existing: {}, generatedCredentials: [] };
  const count = (kind: 'created' | 'existing', key: string) => { report[kind][key] = (report[kind][key] ?? 0) + 1; };

  if (o.sampleData && isProd && !o.staffPassword) throw new Error('SEED_STAFF_PASSWORD is required to seed sample data in production');

  // ---- super admin (credentials from the environment only)
  const adminEmail = o.adminEmail.trim().toLowerCase();
  if (await User.exists({ email: adminEmail })) {
    count('existing', 'superAdmin');
  } else {
    await User.create({ name: o.adminName ?? 'Super Admin', email: adminEmail, role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(o.adminPassword, rounds) });
    count('created', 'superAdmin');
  }
  log(`super admin ${adminEmail}: ${report.created.superAdmin ? 'created' : 'already exists'}`);
  if (!o.sampleData) return report;

  // ---- staff users are created with one shared password per run
  const staffPassword = o.staffPassword ?? randomPassword();
  const staffHash = await bcrypt.hash(staffPassword, rounds);
  const ensureUser = async (name: string, email: string, role: 'DOCTOR' | 'RECEPTIONIST', key: string) => {
    const found = await User.findOne({ email });
    if (found) { count('existing', key); return found; }
    const u = await User.create({ name, email, role, passwordHash: staffHash });
    count('created', key);
    if (!o.staffPassword) report.generatedCredentials.push({ email, password: staffPassword });
    return u;
  };

  // ---- departments
  const dept: Record<string, any> = {};
  for (const d of DEPARTMENTS) {
    const found = await Department.findOne({ name: d.name }).collation({ locale: 'en', strength: 2 });
    if (found) { dept[d.name] = found; count('existing', 'departments'); } else { dept[d.name] = await Department.create(d); count('created', 'departments'); }
  }

  // ---- doctors + schedules
  const doctors: { doc: any; slotDuration: number }[] = [];
  for (const d of DOCTORS) {
    const user = await ensureUser(d.name, d.email, 'DOCTOR', 'doctors');
    let doc = await Doctor.findOne({ user: user._id });
    if (!doc) {
      doc = await Doctor.create({ user: user._id, department: dept[d.dept]._id, specialization: d.specialization, consultationFee: d.fee, room: d.room, experienceYears: 8 });
    }
    if (!(await DoctorSchedule.exists({ doctor: doc._id }))) {
      await DoctorSchedule.create({
        doctor: doc._id, timezone: tz, workingDays: [1, 2, 3, 4, 5, 6], slotDuration: d.slot,
        sessions: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '17:00' }],
        breaks: [{ start: '11:00', end: '11:20' }],
      });
      count('created', 'schedules');
    } else count('existing', 'schedules');
    doctors.push({ doc, slotDuration: d.slot });
  }

  // ---- receptionists
  const receptionists: any[] = [];
  for (const r of RECEPTIONISTS) receptionists.push(await ensureUser(r.name, r.email, 'RECEPTIONIST', 'receptionists'));

  // ---- patients (natural key: mobile + name)
  const patients: any[] = [];
  for (const [name, mobile, gender, dob] of PATIENTS) {
    const found = await Patient.findOne({ mobile, name });
    if (found) { patients.push(found); count('existing', 'patients'); continue; }
    patients.push(await Patient.create({ patientId: await nextPatientId(), name, mobile, gender, dateOfBirth: new Date(`${dob}T00:00:00Z`) }));
    count('created', 'patients');
  }

  // ---- sample appointments: created once (tagged), on upcoming working days, through the same slot rules as the API
  if (await Appointment.exists({ purpose: /^\[Sample\]/ })) {
    report.existing.appointments = await Appointment.countDocuments({ purpose: /^\[Sample\]/ });
  } else {
    const today = nowInTimezone(tz).date;
    let n = 0;
    for (const { doc } of doctors) {
      const schedule = await DoctorSchedule.findOne({ doctor: doc._id, isActive: true });
      if (!schedule) continue;
      let booked = 0;
      for (let offset = 1; offset <= 10 && booked < 3; offset++) {
        const date = addDays(today, offset);
        const slots = generateSlots(schedule, date);
        if (!slots.length) continue; // not a working day
        const slot = slots[(booked * 3 + 1) % slots.length];
        const patient = patients[(n + booked) % patients.length];
        await Appointment.create({
          patient: patient._id, doctor: doc._id, department: doc.department, appointmentDate: date,
          startTime: slot.startTime, endTime: slot.endTime, purpose: `${SAMPLE_TAG}${PURPOSES[(n + booked) % PURPOSES.length]}`,
          createdBy: receptionists[n % receptionists.length]._id,
        });
        booked++; n++;
        count('created', 'appointments');
      }
    }
  }
  log(`sample data ready: ${JSON.stringify(report.created)} created, ${JSON.stringify(report.existing)} already present`);
  return report;
}

async function main() {
  const { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME, SEED_STAFF_PASSWORD, SEED_SAMPLE_DATA } = env;
  if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set (see .env.example)');
  const adminOnly = process.argv.includes('--admin-only');
  const sampleData = !adminOnly && (SEED_SAMPLE_DATA ? SEED_SAMPLE_DATA === 'true' : !isProd);
  await connectDb();
  try {
    const report = await runSeed({ adminEmail: SEED_ADMIN_EMAIL, adminPassword: SEED_ADMIN_PASSWORD, adminName: SEED_ADMIN_NAME, staffPassword: SEED_STAFF_PASSWORD, sampleData, log: (m) => console.log(m) });
    console.log('created:', report.created, '\nalready present:', report.existing);
    if (report.generatedCredentials.length) {
      console.log('\nGenerated passwords for NEW sample staff (shown once, change or discard after use):');
      for (const c of report.generatedCredentials) console.log(`  ${c.email}  ${c.password}`);
    }
  } finally {
    await disconnectDb();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`Seed failed: ${e.message}`); process.exit(1); });
}
