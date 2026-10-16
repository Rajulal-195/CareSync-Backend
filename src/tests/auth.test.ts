import jwt, { SignOptions } from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../app';
import { AuditLog } from '../models/AuditLog';
import { RefreshSession } from '../models/RefreshSession';
import { User } from '../models/User';
import { ADMIN, auth, clearDb, cookieValue, seedAdmin, startDb, stopDb } from './helpers';

const app = createApp();
const refreshReq = (rt: string, csrf: string) =>
  request(app).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${rt}`, `csrf_token=${csrf}`]).set('X-CSRF-Token', csrf);

describe('auth', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(async () => { await clearDb(); await seedAdmin(); });

  it('logs in, sets an HttpOnly refresh cookie, never leaks hashes or the refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/login').send(ADMIN).expect(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refresh_token/i);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('refresh_token='))).toMatch(/HttpOnly/i);
    expect(cookieValue(res, 'refresh_token')).not.toBe(res.body.data.accessToken);
    expect(await AuditLog.countDocuments({ action: 'LOGIN_SUCCESS' })).toBe(1);
  });

  it('rejects bad credentials, inactive users and records failures', async () => {
    await request(app).post('/api/v1/auth/login').send({ ...ADMIN, password: 'wrong-password-123' }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'whatever-123456' }).expect(401);
    await User.updateOne({ email: ADMIN.email }, { isActive: false });
    await request(app).post('/api/v1/auth/login').send(ADMIN).expect(401);
    expect(await AuditLog.countDocuments({ action: 'LOGIN_FAILURE' })).toBe(3);
  });

  it('rejects unknown body fields (no mass assignment of role)', async () => {
    await request(app).post('/api/v1/auth/login').send({ ...ADMIN, role: 'SUPER_ADMIN' }).expect(400);
  });

  it('GET /me requires a valid token', async () => {
    await request(app).get('/api/v1/auth/me').expect(401);
    await request(app).get('/api/v1/auth/me').set(auth('garbage')).expect(401);
    const t = (await request(app).post('/api/v1/auth/login').send(ADMIN)).body.data.accessToken;
    const me = await request(app).get('/api/v1/auth/me').set(auth(t)).expect(200);
    expect(me.body.data.user.email).toBe(ADMIN.email);
    expect(me.body.data.user.passwordHash).toBeUndefined();
  });

  it('has no public registration route', async () => {
    await request(app).post('/api/v1/auth/register').send({ ...ADMIN, role: 'SUPER_ADMIN' }).expect(404);
  });

  it('requires CSRF token for refresh and logout', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(ADMIN);
    const rt = cookieValue(login, 'refresh_token');
    await request(app).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${rt}`]).expect(403);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${rt}`, 'csrf_token=a']).set('X-CSRF-Token', 'b').expect(403);
    await request(app).post('/api/v1/auth/refresh').set('Origin', 'https://evil.example').set('Cookie', [`refresh_token=${rt}`, 'csrf_token=a']).set('X-CSRF-Token', 'a').expect(403);
    await request(app).post('/api/v1/auth/logout').set('Cookie', [`refresh_token=${rt}`]).expect(403);
  });

  it('rotates refresh tokens and revokes the whole session family on reuse', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(ADMIN);
    const csrf = login.body.data.csrfToken;
    const rt1 = cookieValue(login, 'refresh_token');

    const r2 = await refreshReq(rt1, csrf).expect(200);
    const rt2 = cookieValue(r2, 'refresh_token');
    expect(rt2).not.toBe(rt1);
    expect(r2.body.data.accessToken).toEqual(expect.any(String));

    await refreshReq(rt1, csrf).expect(401); // replay of rotated token = theft signal
    await refreshReq(rt2, csrf).expect(401); // ...so the legitimate descendant is revoked too
    expect(await AuditLog.countDocuments({ action: 'REFRESH_TOKEN_REUSE_DETECTED' })).toBe(1);
  });

  it('only one of two concurrent refreshes with the same token wins', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(ADMIN);
    const csrf = login.body.data.csrfToken;
    const rt = cookieValue(login, 'refresh_token');
    const results = await Promise.all([refreshReq(rt, csrf), refreshReq(rt, csrf)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('logout revokes the session and audits it', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(ADMIN);
    const csrf = login.body.data.csrfToken;
    const rt = cookieValue(login, 'refresh_token');
    await request(app).post('/api/v1/auth/logout').set('Cookie', [`refresh_token=${rt}`, `csrf_token=${csrf}`]).set('X-CSRF-Token', csrf).expect(200);
    expect(await RefreshSession.countDocuments({ revokedAt: { $ne: null } })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'LOGOUT' })).toBe(1);
    await refreshReq(rt, csrf).expect(401);
  });

  it('deactivating a user revokes sessions and blocks existing access tokens', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(ADMIN);
    const t = login.body.data.accessToken;
    await User.updateOne({ email: ADMIN.email }, { isActive: false });
    await request(app).get('/api/v1/auth/me').set(auth(t)).expect(401);
    await refreshReq(cookieValue(login, 'refresh_token'), login.body.data.csrfToken).expect(401);
  });

  describe('access token validation and protected routes', () => {
    const secret = () => process.env.JWT_ACCESS_SECRET!;
    const sign = async (claims: object = {}, key = secret(), opts: SignOptions = {}) => {
      const u = await User.findOne({ email: ADMIN.email });
      const options: SignOptions = { subject: String(u!._id), issuer: 'emr-api', audience: 'emr-web', expiresIn: 600, ...opts };
      if (options.expiresIn === undefined) delete options.expiresIn; // jsonwebtoken rejects an explicit `expiresIn: undefined`
      return jwt.sign({ role: 'SUPER_ADMIN', ...claims }, key, options);
    };
    const me = (t: string) => request(app).get('/api/v1/auth/me').set(auth(t));

    it('accepts a correctly signed token (control)', async () => {
      await me(await sign()).expect(200);
    });

    it('rejects an expired access token', async () => {
      const expired = await sign({ exp: Math.floor(Date.now() / 1000) - 60 }, secret(), { expiresIn: undefined });
      const res = await me(expired).expect(401);
      expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
    });

    it('rejects forged / mismatched tokens', async () => {
      await me(await sign({}, 'x'.repeat(40))).expect(401);                          // wrong signing key
      await me(await sign({}, secret(), { audience: 'someone-else' })).expect(401);   // wrong audience
      await me(await sign({}, secret(), { issuer: 'evil' })).expect(401);             // wrong issuer
      await me(await sign({}, process.env.JWT_REFRESH_SECRET!)).expect(401);          // refresh secret must not work as access secret
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: String((await User.findOne({ email: ADMIN.email }))!._id), role: 'SUPER_ADMIN', iss: 'emr-api', aud: 'emr-web', exp: Math.floor(Date.now() / 1000) + 600 })}.`;
      await me(none).expect(401);                                                    // alg=none
      await me(`${(await sign()).slice(0, -3)}abc`).expect(401);                      // tampered signature
    });

    it('rejects tokens whose user no longer exists, is deactivated, or has a different role in the DB', async () => {
      const ghost = jwt.sign({ role: 'SUPER_ADMIN' }, secret(), { subject: '64b64b64b64b64b64b64b64b', issuer: 'emr-api', audience: 'emr-web', expiresIn: 600 });
      await me(ghost).expect(401);
      await User.updateOne({ email: ADMIN.email }, { role: 'RECEPTIONIST' }); // role claim in the token is ignored; the DB is the authority
      await request(app).get('/api/v1/dashboard/admin').set(auth(await sign({ role: 'SUPER_ADMIN' }))).expect(403);
      await User.updateOne({ email: ADMIN.email }, { isActive: false });
      await me(await sign()).expect(401);
    });

    it('requires authentication on every protected route', async () => {
      const id = '64b64b64b64b64b64b64b64b';
      const routes: [string, string][] = [
        ['get', '/auth/me'], ['get', '/doctors'], ['post', '/doctors'], ['get', `/doctors/${id}`], ['put', `/doctors/${id}`],
        ['get', '/receptionists'], ['post', '/receptionists'], ['get', '/departments'], ['post', '/departments'],
        ['get', `/schedules/${id}`], ['put', `/schedules/${id}`], ['get', '/slots?date=2030-01-01'],
        ['get', '/patients'], ['post', '/patients'], ['get', `/patients/${id}`],
        ['get', '/appointments'], ['post', '/appointments'], ['get', `/appointments/${id}`], ['put', `/appointments/${id}`], ['delete', `/appointments/${id}`],
        ['post', `/appointments/${id}/arrive`], ['post', `/appointments/${id}/complete`], ['get', '/dashboard/stats'], ['get', '/audit-logs'],
      ];
      for (const [verb, path] of routes) {
        const res = await (request(app) as any)[verb](`/api/v1${path}`).send({});
        expect([verb, path, res.status]).toEqual([verb, path, 401]);
      }
    });
  });
});
