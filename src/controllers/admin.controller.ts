import { asyncHandler } from '../utils/asyncHandler';
import * as dept from '../services/department.service';
import * as staff from '../services/staff.service';
import * as schedule from '../services/schedule.service';
import * as slots from '../services/slot.service';

const id = (req: any) => req.params.id as string;

export const createDepartment = asyncHandler(async (req, res) => { res.status(201).json({ data: await dept.createDepartment(req.user!, req.body) }); });
export const listDepartments = asyncHandler(async (req, res) => { res.json({ data: await dept.listDepartments(req.query as any) }); });
export const getDepartment = asyncHandler(async (req, res) => { res.json({ data: await dept.getDepartment(id(req)) }); });
export const updateDepartment = asyncHandler(async (req, res) => { res.json({ data: await dept.updateDepartment(req.user!, id(req), req.body) }); });

export const createDoctor = asyncHandler(async (req, res) => { res.status(201).json({ data: await staff.createDoctor(req.user!, req.body) }); });
export const listDoctors = asyncHandler(async (req, res) => { res.json(await staff.listDoctors(req.query as any)); });
export const getDoctor = asyncHandler(async (req, res) => { res.json({ data: await staff.getDoctor(id(req)) }); });
export const updateDoctor = asyncHandler(async (req, res) => { res.json({ data: await staff.updateDoctor(req.user!, id(req), req.body) }); });

export const createReceptionist = asyncHandler(async (req, res) => { res.status(201).json({ data: await staff.createReceptionist(req.user!, req.body) }); });
export const listReceptionists = asyncHandler(async (req, res) => { res.json(await staff.listReceptionists(req.query as any)); });
export const getReceptionist = asyncHandler(async (req, res) => { res.json({ data: await staff.getReceptionist(id(req)) }); });
export const updateReceptionist = asyncHandler(async (req, res) => { res.json({ data: await staff.updateReceptionist(req.user!, id(req), req.body) }); });

export const putSchedule = asyncHandler(async (req, res) => { res.json({ data: await schedule.upsertSchedule(req.user!, id(req), req.body) }); });
export const getSchedule = asyncHandler(async (req, res) => { res.json({ data: await schedule.getSchedule(id(req)) }); });
export const patchSchedule = asyncHandler(async (req, res) => { res.json({ data: await schedule.patchSchedule(req.user!, id(req), req.body) }); });
export const getSlots = asyncHandler(async (req, res) => { res.json({ data: await slots.doctorSlots(id(req), (req.query as any).date) }); });
