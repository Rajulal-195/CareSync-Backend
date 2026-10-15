import { asyncHandler } from '../utils/asyncHandler';
import { listAuditLogs } from '../services/audit.service';

export const list = asyncHandler(async (req, res) => { res.json(await listAuditLogs(req.query as any)); });
