import { asyncHandler } from '../utils/asyncHandler';
import { Errors } from '../utils/errors';
import { listSlots } from '../services/slot.service';

export const list = asyncHandler(async (req, res) => {
  const q = req.query as any;
  const data = await listSlots(q);
  // A specific doctor with no usable schedule is "not found", consistent with GET /doctors/:id/slots.
  if (q.doctorId && data.length === 0) throw Errors.notFound('Doctor has no active schedule');
  res.json({ data });
});
