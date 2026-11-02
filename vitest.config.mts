import { defineConfig } from 'vitest/config';

// Layers are selected by file suffix (context/foundation/test-strategy.md, Layer contract):
//   *.test.ts      unit — pure logic, no database, network or Electron
//   *.int.test.ts  integration — real MongoDB from docker-compose.yml, local HTTP
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test-support/**/*.test.ts'],
          exclude: ['**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.test.ts', 'test-support/**/*.int.test.ts'],
          globalSetup: ['test-support/mongo-global-setup.ts'],
        },
      },
    ],
  },
});
