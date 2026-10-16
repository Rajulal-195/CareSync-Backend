import { Department } from '../models/Department';
import { Doctor } from '../models/Doctor';
import { Errors, isDuplicateKey } from '../utils/errors';
import { audit } from './audit.service';

export async function createDepartment(actor: Express.AuthUser, input: { name: string; description?: string }) {
  try {
    const d = await Department.create(input);
    await audit({ userId: actor.id, role: actor.role, action: 'DEPARTMENT_CREATED', entity: 'Department', entityId: d._id });
    return d;
  } catch (e) {
    if (isDuplicateKey(e)) throw Errors.conflict('Department name already exists');
    throw e;
  }
}
export const listDepartments = (q: { isActive?: boolean }) =>
  Department.find(q.isActive === undefined ? {} : { isActive: q.isActive }).sort({ name: 1 }).lean();

export async function updateDepartment(actor: Express.AuthUser, id: string, patch: { name?: string; description?: string; isActive?: boolean }) {
  if (patch.isActive === false && (await Doctor.exists({ department: id, isActive: true })))
    throw Errors.conflict('Cannot deactivate a department that still has active doctors');
  try {
    const d = await Department.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true });
    if (!d) throw Errors.notFound('Department not found');
    await audit({ userId: actor.id, role: actor.role, action: 'DEPARTMENT_UPDATED', entity: 'Department', entityId: d._id, metadata: { fields: Object.keys(patch) } });
    return d;
  } catch (e) {
    if (isDuplicateKey(e)) throw Errors.conflict('Department name already exists');
    throw e;
  }
}

export async function getDepartment(id: string) {
  const d = await Department.findById(id);
  if (!d) throw Errors.notFound('Department not found');
  return d;
}
