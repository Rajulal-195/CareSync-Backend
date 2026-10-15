module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/src/tests/setupEnv.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  testTimeout: 60000,
};
