import { asyncHandler } from '../utils/asyncHandler';
import * as d from '../services/dashboard.service';

export const admin = asyncHandler(async (req, res) => { res.json({ data: await d.adminDashboard((req.query as any).date) }); });
export const receptionist = asyncHandler(async (req, res) => { res.json({ data: await d.receptionistDashboard((req.query as any).date) }); });
export const doctor = asyncHandler(async (req, res) => { res.json({ data: await d.doctorDashboard(req.user!, (req.query as any).date) }); });
/** One role-aware stats endpoint: the caller's role decides which dashboard they get. */
export const stats = asyncHandler(async (req, res) => {
  const u = req.user!;
  const date = (req.query as any).date;
  const data = u.role === 'SUPER_ADMIN' ? await d.adminDashboard(date) : u.role === 'RECEPTIONIST' ? await d.receptionistDashboard(date) : await d.doctorDashboard(u, date);
  res.json({ data: { role: u.role, ...data } });
});
