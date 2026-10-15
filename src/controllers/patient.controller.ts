import { asyncHandler } from '../utils/asyncHandler';
import * as patients from '../services/patient.service';

export const register = asyncHandler(async (req, res) => { res.status(201).json({ data: await patients.registerPatient(req.user!, req.body) }); });
export const search = asyncHandler(async (req, res) => { res.json(await patients.searchPatients(req.query as any)); });
export const get = asyncHandler(async (req, res) => { res.json({ data: await patients.getPatient(req.user!, req.params.id) }); });
export const update = asyncHandler(async (req, res) => { res.json({ data: await patients.updatePatient(req.user!, req.params.id, req.body) }); });
