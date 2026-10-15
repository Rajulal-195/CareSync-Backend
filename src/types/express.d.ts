import type { Role } from '../models/constants';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      role: Role;
      name: string;
      doctorId?: string;
      tokenExp?: number;
    }
    interface Request {
      user?: AuthUser;
      id?: string; // request / correlation id
    }
  }
}
export {};
