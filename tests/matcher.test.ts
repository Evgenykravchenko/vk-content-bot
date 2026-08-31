import { describe, expect, it } from 'vitest';
import { findBestRule } from '../src/domain/matcher.js';
import type { KeywordRule } from '../src/domain/types.js';

function rule(overrides: Partial<KeywordRule>): KeywordRule {
  return {
    id: 1,
    phrase: 'прайс',
    match_mode: 'contains',
    priority: 10,
    response: 1,
    enabled: true,
    ...overrides,
  };
}

describe('findBestRule', () => {
  it('matches normalized text', () => {
    expect(findBestRule('Покажи ПРАЙС!', [rule({})])?.id).toBe(1);
  });

  it('prefers priority over phrase length', () => {
    const result = findBestRule('нужен полный прайс', [
      rule({ id: 1, phrase: 'полный прайс', priority: 10 }),
      rule({ id: 2, phrase: 'прайс', priority: 20 }),
    ]);
    expect(result?.id).toBe(2);
  });

  it('prefers a longer phrase when priorities are equal', () => {
    const result = findBestRule('нужен полный прайс', [
      rule({ id: 1, phrase: 'прайс' }),
      rule({ id: 2, phrase: 'полный прайс' }),
    ]);
    expect(result?.id).toBe(2);
  });

  it('supports all_words mode', () => {
    const result = findBestRule('покажи новый каталог пожалуйста', [
      rule({ phrase: 'каталог новый', match_mode: 'all_words' }),
    ]);
    expect(result).toBeDefined();
  });
});
