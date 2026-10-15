import { asyncHandler } from '../utils/asyncHandler';
import { listSlots } from '../services/slot.service';

export const list = asyncHandler(async (req, res) => { res.json({ data: await listSlots(req.query as any) }); });
