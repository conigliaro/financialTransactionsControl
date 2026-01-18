import { describe, it, expect } from 'vitest';

import { normalizeCategoryId } from '../utils/payload.js';

describe('normalizeCategoryId', () => {
  it('returns null for non-numeric strings', () => {
    expect(normalizeCategoryId('pruebas')).toBe(null);
    expect(normalizeCategoryId('')).toBe(null);
    expect(normalizeCategoryId('   ')).toBe(null);
    expect(normalizeCategoryId('12a')).toBe(null);
  });

  it('converts numeric strings to numbers', () => {
    expect(normalizeCategoryId('123')).toBe(123);
    expect(normalizeCategoryId('  55 ')).toBe(55);
  });

  it('passes through finite numbers and rejects NaN', () => {
    expect(normalizeCategoryId(55)).toBe(55);
    expect(normalizeCategoryId(Number.NaN)).toBe(null);
  });
});

