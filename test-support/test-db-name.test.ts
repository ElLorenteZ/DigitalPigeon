import { describe, expect, test } from 'vitest';
import { assertTestDbName, testDbName } from './test-db-name';

describe('testDbName', () => {
  test('generates a name carrying the dp_test_ prefix', () => {
    expect(testDbName()).toMatch(/^dp_test_\d+_[a-z0-9]+$/);
  });

  test('generates a different name on every call', () => {
    const names = new Set(Array.from({ length: 100 }, () => testDbName()));
    expect(names.size).toBe(100);
  });

  test('generates names the guard accepts', () => {
    expect(() => assertTestDbName(testDbName())).not.toThrow();
  });
});

describe('assertTestDbName', () => {
  test.each([
    'digital_pigeon',
    'digital-pigeon',
    'admin',
    'local',
    'config',
    '',
    'xdp_test_1',
    'DP_TEST_1',
    'dp_test',
    'dp_test_',
  ])('refuses %j', (name) => {
    expect(() => assertTestDbName(name)).toThrow(/dp_test_/);
  });

  test('accepts a name with the prefix', () => {
    expect(() =>
      assertTestDbName('dp_test_1730000000000_abc123'),
    ).not.toThrow();
  });
});
