const BASE: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/emr',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

/** Loads config/env.ts in isolation with EXACTLY the given environment (nothing leaks in from the host or a .env file). */
function load(overrides: Record<string, string | undefined> = {}) {
  const saved = process.env;
  process.env = { ...BASE, ...overrides } as NodeJS.ProcessEnv;
  try {
    let mod: any;
    jest.isolateModules(() => { mod = require('../config/env'); });
    return mod;
  } finally {
    process.env = saved;
  }
}

describe('environment validation', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => errorSpy.mockRestore());

  it('applies safe defaults', () => {
    const { env, corsOrigins } = load();
    expect(env.PORT).toBe(5000);
    expect(env.ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TTL_SECONDS).toBe(604800);
    expect(env.FRONTEND_URL).toBe('http://localhost:5173');
    expect(corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('parses durations and extra CORS origins', () => {
    const { env, corsOrigins } = load({ JWT_ACCESS_EXPIRES_IN: '30m', JWT_REFRESH_EXPIRES_IN: '14d', CORS_ORIGINS: 'https://admin.example.com, https://app.example.com', FRONTEND_URL: 'https://clinic.example.com' });
    expect(env.ACCESS_TTL_SECONDS).toBe(1800);
    expect(env.REFRESH_TTL_SECONDS).toBe(14 * 86400);
    expect(corsOrigins).toEqual(['https://clinic.example.com', 'https://admin.example.com', 'https://app.example.com']);
  });

  it.each([
    ['missing MONGODB_URI', { MONGODB_URI: undefined }],
    ['empty MONGODB_URI (as in an unfilled .env.example)', { MONGODB_URI: '' }],
    ['non-mongo MONGODB_URI', { MONGODB_URI: 'http://localhost:27017' }],
    ['missing access secret', { JWT_ACCESS_SECRET: undefined }],
    ['empty refresh secret', { JWT_REFRESH_SECRET: '' }],
    ['short access secret', { JWT_ACCESS_SECRET: 'too-short' }],
    ['identical secrets', { JWT_REFRESH_SECRET: 'a'.repeat(32) }],
    ['malformed access duration', { JWT_ACCESS_EXPIRES_IN: '15 minutes' }],
    ['access token longer than a day', { JWT_ACCESS_EXPIRES_IN: '2d' }],
    ['refresh not longer than access', { JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '10m' }],
    ['wildcard frontend origin', { FRONTEND_URL: '*' }],
    ['trailing slash in origin', { FRONTEND_URL: 'http://localhost:5173/' }],
    ['wildcard in extra origins', { CORS_ORIGINS: 'https://ok.example.com,*' }],
    ['bad port', { PORT: '99999' }],
    ['unknown NODE_ENV', { NODE_ENV: 'staging' }],
    ['bad timezone', { APP_TIMEZONE: 'Mars/Base' }],
    ['seed email without password', { SEED_ADMIN_EMAIL: 'admin@example.com' }],
    ['weak seed password', { SEED_ADMIN_EMAIL: 'admin@example.com', SEED_ADMIN_PASSWORD: 'short' }],
    ['placeholder secrets in production', { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me' }],
  ])('refuses to start: %s', (_name, overrides) => {
    expect(() => load(overrides)).toThrow('Invalid environment configuration');
  });

  it('reports which variables are wrong but never prints secret values', () => {
    expect(() => load({ JWT_ACCESS_SECRET: 'super-secret-value-xyz', MONGODB_URI: undefined })).toThrow();
    const output = errorSpy.mock.calls.flat().join('\n');
    expect(output).toContain('MONGODB_URI');
    expect(output).toContain('JWT_ACCESS_SECRET');
    expect(output).not.toContain('super-secret-value-xyz');
  });

  it('accepts an empty seed section (seed vars are optional for the server itself)', () => {
    expect(() => load({ SEED_ADMIN_EMAIL: '', SEED_ADMIN_PASSWORD: '' })).not.toThrow();
  });
});
