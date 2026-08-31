import { describe, expect, it } from 'vitest';
import { normalizeText, splitWords } from '../src/domain/text.js';

describe('normalizeText', () => {
  it('normalizes case, punctuation, whitespace and ё', () => {
    expect(normalizeText('  ПОКАЖИ, пожалуйста, Ёлку!  ')).toBe('покажи пожалуйста елку');
  });

  it('keeps letters, digits and hyphens', () => {
    expect(normalizeText('Курс-2026 №1')).toBe('курс-2026 1');
  });
});

describe('splitWords', () => {
  it('returns an empty list for blank input', () => {
    expect(splitWords('   ')).toEqual([]);
  });
});
