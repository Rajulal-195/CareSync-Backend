/* OpenAPI 3.0 spec, served at /api/docs (Swagger UI) and /api/docs.json. Kept in code so it ships with the API. */
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const jsonBody = (schema: unknown) => ({ required: true, content: { 'application/json': { schema } } });
const ok = (description: string, schema?: unknown) => ({ description, ...(schema ? { content: { 'application/json': { schema } } } : {}) });
const envelopeProps = { success: { type: 'boolean', example: true }, message: { type: 'string', example: 'Operation successful' } };
const wrap = (schema: unknown) => ({ type: 'object', properties: { ...envelopeProps, data: schema, meta: { type: 'object', additionalProperties: true } } });
const paged = (schema: unknown) => ({ type: 'object', properties: { ...envelopeProps, data: { type: 'array', items: schema }, meta: ref('PageMeta') } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } };
const q = (name: string, type = 'string', extra: object = {}) => ({ name, in: 'query', schema: { type, ...extra } });
const pageQ = [q('page', 'integer', { minimum: 1, default: 1 }), q('limit', 'integer', { minimum: 1, maximum: 100, default: 20 })];
const errs = { '400': ref400(), '401': ref401(), '403': ref403() };
function ref400() { return { description: 'Validation error', content: { 'application/json': { schema: ref('Error') } } }; }
function ref401() { return { description: 'Not authenticated', content: { 'application/json': { schema: ref('Error') } } }; }
function ref403() { return { description: 'Forbidden (role / CSRF)', content: { 'application/json': { schema: ref('Error') } } }; }

interface Op { tag: string; summary: string; roles?: string; body?: unknown; params?: unknown[]; res: Record<string, unknown>; secured?: boolean }
const op = (o: Op) => ({
  tags: [o.tag],
  summary: o.summary,
  description: o.roles ? `Roles: ${o.roles}` : undefined,
  ...(o.secured === false ? {} : { security: [{ bearerAuth: [] }] }),
  ...(o.params ? { parameters: o.params } : {}),
  ...(o.body ? { requestBody: jsonBody(o.body) } : {}),
  responses: { ...o.res, ...errs },
});

export const openApiSpec = {
  openapi: '3.0.3',
  info: { title: 'EMR Appointment Management API', version: '1.0.0', description: 'Success: `{ success: true, message, data, meta }`. Error: `{ success: false, message, error: { code, details? }, requestId }`. Access token: `Authorization: Bearer`. Refresh token lives in an HttpOnly cookie; `/auth/refresh` and `/auth/logout` also need the `X-CSRF-Token` header (value from login/refresh/csrf response, must equal the `csrf_token` cookie). Errors: `{ "error": { code, message, details? } }`.' },
  servers: [{ url: '/api/v1' }],
  tags: ['System', 'Auth', 'Departments', 'Doctors', 'Schedules', 'Slots', 'Receptionists', 'Patients', 'Appointments', 'Dashboard', 'Audit'].map((name) => ({ name })),
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { success: { type: 'boolean', example: false }, message: { type: 'string' }, error: { type: 'object', properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, details: {} } }, requestId: { type: 'string' } } },
      PageMeta: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, pages: { type: 'integer' }, hasNextPage: { type: 'boolean' }, hasPrevPage: { type: 'boolean' }, sortBy: { type: 'string' }, sortOrder: { enum: ['asc', 'desc'] } } },
      User: { type: 'object', properties: { _id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, role: { enum: ['SUPER_ADMIN', 'RECEPTIONIST', 'DOCTOR'] }, isActive: { type: 'boolean' } } },
      Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
      AuthResult: wrap({ type: 'object', properties: { accessToken: { type: 'string' }, tokenType: { type: 'string' }, expiresIn: { type: 'integer' }, csrfToken: { type: 'string' }, user: ref('User') } }),
      Department: { type: 'object', properties: { _id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, isActive: { type: 'boolean' } } },
      DepartmentInput: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, isActive: { type: 'boolean' } } },
      Doctor: { type: 'object', properties: { _id: { type: 'string' }, user: ref('User'), department: ref('Department'), specialization: { type: 'string' }, qualification: { type: 'string' }, experienceYears: { type: 'integer' }, consultationFee: { type: 'number' }, room: { type: 'string' }, isActive: { type: 'boolean' } } },
      DoctorInput: { type: 'object', required: ['name', 'email', 'password', 'departmentId', 'specialization'], properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 12 }, departmentId: { type: 'string' }, specialization: { type: 'string' }, qualification: { type: 'string' }, experienceYears: { type: 'integer' }, consultationFee: { type: 'number' }, room: { type: 'string' } } },
      ReceptionistInput: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 12 } } },
      Interval: { type: 'object', required: ['start', 'end'], properties: { start: { type: 'string', example: '09:00' }, end: { type: 'string', example: '12:00' } } },
      Schedule: { type: 'object', required: ['timezone', 'workingDays', 'sessions', 'slotDuration'], properties: { timezone: { type: 'string', example: 'Asia/Kolkata' }, workingDays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '0=Sunday' }, sessions: { type: 'array', items: ref('Interval') }, slotDuration: { type: 'integer', example: 30 }, breaks: { type: 'array', items: ref('Interval') }, isActive: { type: 'boolean' } } },
      Slots: wrap(ref('DoctorSlots')),
      Patient: { type: 'object', properties: { _id: { type: 'string' }, patientId: { type: 'string', example: 'PT-000001' }, name: { type: 'string' }, mobile: { type: 'string' }, email: { type: 'string' }, dateOfBirth: { type: 'string', format: 'date-time' }, gender: { enum: ['MALE', 'FEMALE', 'OTHER'] } } },
      PatientInput: { type: 'object', required: ['name', 'mobile'], properties: { name: { type: 'string' }, mobile: { type: 'string', example: '+919876543210' }, email: { type: 'string' }, dateOfBirth: { type: 'string', example: '1990-05-17' }, gender: { enum: ['MALE', 'FEMALE', 'OTHER'] } } },
      Appointment: { type: 'object', properties: { _id: { type: 'string' }, patient: ref('Patient'), doctor: ref('Doctor'), department: ref('Department'), appointmentDate: { type: 'string', example: '2026-11-02' }, startTime: { type: 'string' }, endTime: { type: 'string' }, purpose: { type: 'string' }, notes: { type: 'string' }, consultationNotes: { type: 'string' }, status: { enum: ['SCHEDULED', 'ARRIVED', 'COMPLETED', 'CANCELLED'] } } },
      AppointmentInput: { type: 'object', required: ['doctorId', 'appointmentDate', 'startTime', 'purpose'], description: 'Provide exactly one of patientId (existing) or newPatient (created atomically with the booking).', properties: { patientId: { type: 'string' }, newPatient: ref('PatientInput'), doctorId: { type: 'string' }, appointmentDate: { type: 'string', example: '2026-11-02' }, startTime: { type: 'string', example: '09:00' }, purpose: { type: 'string' }, notes: { type: 'string' } } },
      SlotItem: { type: 'object', properties: { startTime: { type: 'string' }, endTime: { type: 'string' }, status: { enum: ['AVAILABLE', 'BOOKED'] }, available: { type: 'boolean' } } },
      DoctorSlots: { type: 'object', properties: { doctorId: { type: 'string' }, doctorName: { type: 'string' }, departmentId: { type: 'string' }, specialization: { type: 'string' }, date: { type: 'string' }, timezone: { type: 'string' }, slotDuration: { type: 'integer' }, slots: { type: 'array', items: ref('SlotItem') } } },
      AppointmentPatch: { type: 'object', properties: { doctorId: { type: 'string' }, appointmentDate: { type: 'string' }, startTime: { type: 'string' }, purpose: { type: 'string' }, notes: { type: 'string' } } },
      Consultation: { type: 'object', properties: { consultationNotes: { type: 'string' }, complete: { type: 'boolean' } } },
      Dashboard: wrap({ type: 'object', additionalProperties: true }),
    },
  },
  paths: {
    '/auth/login': { post: op({ tag: 'Auth', summary: 'Login (rate limited). Sets HttpOnly refresh cookie.', secured: false, body: ref('Login'), res: { '200': ok('Access token + csrfToken', ref('AuthResult')), '429': ok('Rate limited') } }) },
    '/auth/refresh': { post: op({ tag: 'Auth', summary: 'Rotate refresh token (cookie + X-CSRF-Token). Reuse of an old token revokes all sessions.', secured: false, res: { '200': ok('New access token', ref('AuthResult')), '429': ok('Rate limited') } }) },
    '/auth/logout': { post: op({ tag: 'Auth', summary: 'Revoke the current session (cookie + X-CSRF-Token)', secured: false, res: { '204': ok('Logged out') } }) },
    '/auth/me': { get: op({ tag: 'Auth', summary: 'Current user', res: { '200': ok('Current user') } }) },
    '/auth/csrf': { get: op({ tag: 'Auth', summary: 'Get/refresh CSRF token (sets csrf_token cookie)', secured: false, res: { '200': ok('csrfToken') } }) },

    '/departments': {
      get: op({ tag: 'Departments', summary: 'List departments', roles: 'SUPER_ADMIN, RECEPTIONIST', params: [q('isActive', 'boolean')], res: { '200': ok('Departments', wrap({ type: 'array', items: ref('Department') })) } }),
      post: op({ tag: 'Departments', summary: 'Create department', roles: 'SUPER_ADMIN', body: ref('DepartmentInput'), res: { '201': ok('Created', wrap(ref('Department'))), '409': ok('Duplicate name') } }),
    },
    '/departments/{id}': { patch: op({ tag: 'Departments', summary: 'Update department', roles: 'SUPER_ADMIN', params: [idParam], body: ref('DepartmentInput'), res: { '200': ok('Updated', wrap(ref('Department'))), '404': ok('Not found') } }) },

    '/doctors': {
      get: op({ tag: 'Doctors', summary: 'List doctors', roles: 'SUPER_ADMIN, RECEPTIONIST', params: [...pageQ, q('departmentId'), q('isActive', 'boolean'), q('search')], res: { '200': ok('Doctors', paged(ref('Doctor'))) } }),
      post: op({ tag: 'Doctors', summary: 'Create doctor (user + profile)', roles: 'SUPER_ADMIN', body: ref('DoctorInput'), res: { '201': ok('Created', wrap(ref('Doctor'))), '409': ok('Email in use') } }),
    },
    '/doctors/{id}': {
      get: op({ tag: 'Doctors', summary: 'Get doctor', roles: 'SUPER_ADMIN, RECEPTIONIST', params: [idParam], res: { '200': ok('Doctor', wrap(ref('Doctor'))), '404': ok('Not found') } }),
      patch: op({ tag: 'Doctors', summary: 'Update doctor (isActive=false also revokes sessions)', roles: 'SUPER_ADMIN', params: [idParam], body: { type: 'object', additionalProperties: true }, res: { '200': ok('Updated', wrap(ref('Doctor'))) } }),
      delete: op({ tag: 'Doctors', summary: 'Delete doctor (profile, schedule, login). 409 HAS_APPOINTMENTS if the doctor has any appointment: deactivate instead', roles: 'SUPER_ADMIN', params: [idParam], res: { '200': ok('Deleted'), '404': ok('Not found'), '409': ok('Has appointment history') } }),
    },
    '/doctors/{id}/schedule': {
      get: op({ tag: 'Doctors', summary: 'Get schedule', roles: 'SUPER_ADMIN, RECEPTIONIST', params: [idParam], res: { '200': ok('Schedule', wrap(ref('Schedule'))) } }),
      patch: op({ tag: 'Doctors', summary: 'Partially update schedule (merged + fully re-validated). 409 SCHEDULE_CONFLICT if it would invalidate upcoming appointments', roles: 'SUPER_ADMIN', params: [idParam], body: { type: 'object', additionalProperties: true }, res: { '200': ok('Saved', wrap(ref('Schedule'))), '409': ok('SCHEDULE_CONFLICT with affected appointments') } }),
      put: op({ tag: 'Doctors', summary: 'Create/replace schedule. 409 SCHEDULE_CONFLICT if it would invalidate upcoming appointments (re-slotting, deactivation, timezone change)', roles: 'SUPER_ADMIN', params: [idParam], body: ref('Schedule'), res: { '200': ok('Saved', wrap(ref('Schedule'))) } }),
    },
    '/doctors/{id}/slots': { get: op({ tag: 'Doctors', summary: 'Slots for a date with availability', roles: 'SUPER_ADMIN, RECEPTIONIST', params: [idParam, { ...q('date'), required: true }], res: { '200': ok('Slots', ref('Slots')) } }) },

    '/receptionists': {
      get: op({ tag: 'Receptionists', summary: 'List receptionists', roles: 'SUPER_ADMIN', params: [...pageQ, q('isActive', 'boolean'), q('search')], res: { '200': ok('Receptionists', paged(ref('User'))) } }),
      post: op({ tag: 'Receptionists', summary: 'Create receptionist', roles: 'SUPER_ADMIN', body: ref('ReceptionistInput'), res: { '201': ok('Created', wrap(ref('User'))) } }),
    },
    '/receptionists/{id}': {
      get: op({ tag: 'Receptionists', summary: 'Get receptionist', roles: 'SUPER_ADMIN', params: [idParam], res: { '200': ok('Receptionist', wrap(ref('User'))) } }),
      patch: op({ tag: 'Receptionists', summary: 'Update receptionist', roles: 'SUPER_ADMIN', params: [idParam], body: { type: 'object', properties: { name: { type: 'string' }, password: { type: 'string' }, isActive: { type: 'boolean' } } }, res: { '200': ok('Updated', wrap(ref('User'))) } }),
      delete: op({ tag: 'Receptionists', summary: 'Delete receptionist. 409 HAS_APPOINTMENTS if they booked any appointment: deactivate instead', roles: 'SUPER_ADMIN', params: [idParam], res: { '200': ok('Deleted'), '404': ok('Not found'), '409': ok('Has booked appointments') } }),
    },

    '/patients': {
      get: op({ tag: 'Patients', summary: 'Search patients by name, mobile or patientId', roles: 'SUPER_ADMIN, RECEPTIONIST', params: [...pageQ, q('q'), q('sortBy', 'string', { enum: ['createdAt', 'name', 'patientId'], default: 'createdAt' }), q('sortOrder', 'string', { enum: ['asc', 'desc'], default: 'desc' })], res: { '200': ok('Patients', paged(ref('Patient'))) } }),
      post: op({ tag: 'Patients', summary: 'Register patient', roles: 'RECEPTIONIST', body: ref('PatientInput'), res: { '201': ok('Created', wrap(ref('Patient'))) } }),
    },
    '/patients/{id}': {
      get: op({ tag: 'Patients', summary: 'Get patient. DOCTOR: only patients with one of their appointments (else 404)', roles: 'SUPER_ADMIN, RECEPTIONIST, DOCTOR', params: [idParam], res: { '200': ok('Patient', wrap(ref('Patient'))), '404': ok('Not found / not yours') } }),
      patch: op({ tag: 'Patients', summary: 'Update patient', roles: 'RECEPTIONIST', params: [idParam], body: ref('PatientInput'), res: { '200': ok('Updated', wrap(ref('Patient'))) } }),
    },

    '/slots': { get: op({ tag: 'Slots', summary: 'Dynamically generated slots (AVAILABLE/BOOKED) from active schedules; past dates/times excluded', roles: 'SUPER_ADMIN, RECEPTIONIST', params: [{ ...q('date'), required: true }, q('doctorId'), q('departmentId')], res: { '200': ok('Per-doctor slots', wrap({ type: 'array', items: ref('DoctorSlots') })), '404': ok('Doctor/department not found') } }) },
    '/appointments': {
      get: op({ tag: 'Appointments', summary: 'List appointments with server-side search, filters, allow-listed sorting and pagination. DOCTOR is always scoped to own appointments', roles: 'SUPER_ADMIN, RECEPTIONIST, DOCTOR', params: [...pageQ, q('q', 'string', { description: 'Search patient name / patient ID (PT-...) / mobile', minLength: 2 }), q('patientName'), q('patientCode', 'string', { example: 'PT-000001' }), q('mobile'), q('status', 'string', { description: 'One or more of SCHEDULED,ARRIVED,COMPLETED,CANCELLED, comma separated' }), q('doctorId'), q('patientId', 'string', { description: 'Patient document id' }), q('departmentId'), q('date'), q('dateFrom'), q('dateTo'), q('sortBy', 'string', { enum: ['appointmentDate', 'startTime', 'createdAt', 'status'], default: 'appointmentDate' }), q('sortOrder', 'string', { enum: ['asc', 'desc'], default: 'asc' })], res: { '200': ok('Appointments', paged(ref('Appointment'))) } }),
      post: op({ tag: 'Appointments', summary: 'Book appointment for an existing patient or a newPatient (transactional). 409 if slot taken, 422 if invalid/past slot. Response includes refreshed `availability`', roles: 'RECEPTIONIST', body: ref('AppointmentInput'), res: { '201': ok('Booked', wrap(ref('Appointment'))), '409': ok('Slot already booked'), '422': ok('Not a valid slot / in the past') } }),
    },
    '/appointments/{id}': {
      get: op({ tag: 'Appointments', summary: 'Get appointment (404 if outside caller scope)', roles: 'SUPER_ADMIN, RECEPTIONIST, DOCTOR', params: [idParam], res: { '200': ok('Appointment', wrap(ref('Appointment'))) } }),
      delete: op({ tag: 'Appointments', summary: 'Logical cancel (record preserved). Optional ?reason= (required if already ARRIVED)', roles: 'RECEPTIONIST', params: [idParam, q('reason')], res: { '200': ok('Cancelled', wrap(ref('Appointment'))), '409': ok('Invalid transition'), '422': ok('Reason required') } }),
      patch: op({ tag: 'Appointments', summary: 'Edit purpose/notes (SCHEDULED or ARRIVED) and/or reschedule (SCHEDULED only)', roles: 'RECEPTIONIST', params: [idParam], body: ref('AppointmentPatch'), res: { '200': ok('Updated', wrap(ref('Appointment'))), '409': ok('Slot taken / not editable') } }),
    },
    '/appointments/{id}/cancel': { post: op({ tag: 'Appointments', summary: 'Cancel (SCHEDULED or ARRIVED). Frees the slot', roles: 'RECEPTIONIST', params: [idParam], body: { type: 'object', properties: { reason: { type: 'string' } } }, res: { '200': ok('Cancelled', wrap(ref('Appointment'))) } }) },
    '/appointments/{id}/arrive': { post: op({ tag: 'Appointments', summary: 'Mark patient arrived (SCHEDULED -> ARRIVED)', roles: 'RECEPTIONIST', params: [idParam], res: { '200': ok('Arrived', wrap(ref('Appointment'))) } }) },
    '/appointments/{id}/complete': { post: op({ tag: 'Appointments', summary: 'ARRIVED -> COMPLETED. Doctor (own, may add consultationNotes) or receptionist (no notes)', roles: 'DOCTOR, RECEPTIONIST', params: [idParam], body: { type: 'object', properties: { consultationNotes: { type: 'string' } } }, res: { '200': ok('Completed', wrap(ref('Appointment'))), '409': ok('Invalid transition') } }) },
    '/appointments/{id}/consultation': { patch: op({ tag: 'Appointments', summary: 'Doctor: add consultation notes and/or complete (ARRIVED -> COMPLETED)', roles: 'DOCTOR (own appointments only)', params: [idParam], body: ref('Consultation'), res: { '200': ok('Updated', wrap(ref('Appointment'))) } }) },

    '/health': { get: op({ tag: 'System', summary: 'Readiness probe (checks MongoDB). 503 when the database is unreachable', secured: false, res: { '200': ok('Healthy', wrap({ type: 'object', properties: { status: { type: 'string' }, db: { type: 'string' }, uptimeSec: { type: 'integer' } } })), '503': ok('Unavailable') } }) },
    '/schedules/{doctorId}': {
      get: op({ tag: 'Schedules', summary: 'Get a doctor\'s schedule (DOCTOR: own only)', roles: 'SUPER_ADMIN, RECEPTIONIST, DOCTOR(own)', params: [{ ...idParam, name: 'doctorId' }], res: { '200': ok('Schedule', wrap(ref('Schedule'))), '404': ok('Not found') } }),
      put: op({ tag: 'Schedules', summary: 'Create/replace schedule. 409 SCHEDULE_CONFLICT if it would invalidate upcoming appointments', roles: 'SUPER_ADMIN', params: [{ ...idParam, name: 'doctorId' }], body: ref('Schedule'), res: { '200': ok('Saved', wrap(ref('Schedule'))), '409': ok('SCHEDULE_CONFLICT') } }),
      patch: op({ tag: 'Schedules', summary: 'Partial schedule update (merged and re-validated)', roles: 'SUPER_ADMIN', params: [{ ...idParam, name: 'doctorId' }], body: { type: 'object', additionalProperties: true }, res: { '200': ok('Saved', wrap(ref('Schedule'))), '409': ok('SCHEDULE_CONFLICT') } }),
    },
    '/audit-logs': { get: op({ tag: 'Audit', summary: 'Audit trail (no passwords, tokens or patient data are ever stored in it)', roles: 'SUPER_ADMIN', params: [...pageQ, q('action'), q('userId'), q('entity'), q('entityId'), q('dateFrom'), q('dateTo'), q('sortOrder', 'string', { enum: ['asc', 'desc'], default: 'desc' })], res: { '200': ok('Audit entries', paged({ type: 'object', additionalProperties: true })) } }) },
    '/dashboard/stats': { get: op({ tag: 'Dashboard', summary: 'Role-aware dashboard: SUPER_ADMIN, RECEPTIONIST or DOCTOR gets their own view', roles: 'any authenticated role', params: [q('date')], res: { '200': ok('Stats', ref('Dashboard')) } }) },
    '/dashboard/admin': { get: op({ tag: 'Dashboard', summary: 'Admin dashboard', roles: 'SUPER_ADMIN', params: [q('date')], res: { '200': ok('Stats', ref('Dashboard')) } }) },
    '/dashboard/receptionist': { get: op({ tag: 'Dashboard', summary: 'Receptionist dashboard', roles: 'RECEPTIONIST', params: [q('date')], res: { '200': ok('Stats', ref('Dashboard')) } }) },
    '/dashboard/doctor': { get: op({ tag: 'Dashboard', summary: 'Doctor dashboard (own data)', roles: 'DOCTOR', params: [q('date')], res: { '200': ok('Stats', ref('Dashboard')) } }) },
  },
};

// PUT mirrors PATCH on these resources (same partial-update body).
for (const p of ['/doctors/{id}', '/appointments/{id}', '/departments/{id}', '/receptionists/{id}', '/patients/{id}']) {
  const item = (openApiSpec.paths as any)[p];
  if (item?.patch) item.put = { ...item.patch, summary: `${item.patch.summary} (PUT alias, same partial-update body)` };
}
