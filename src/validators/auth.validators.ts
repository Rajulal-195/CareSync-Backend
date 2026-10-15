import { z } from 'zod';
import { email } from './common';

export const loginBody = z.object({ email, password: z.string().min(1).max(200) }).strict();
