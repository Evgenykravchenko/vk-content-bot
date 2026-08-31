import { describe, expect, it } from 'vitest';
import { buildResponseKeyboard, keywordFromButtonPayload } from '../src/domain/keyboard.js';
import type { ResponseButton } from '../src/domain/types.js';

function button(overrides: Partial<ResponseButton> = {}): ResponseButton {
  return {
    id: 1,
    response: 1,
    label: 'Показать ещё',
    action: 'text',
    target: 'ещё контент',
    color: 'primary',
    row_number: 1,
    sort: 10,
    enabled: true,
    ...overrides,
  };
}

describe('buildResponseKeyboard', () => {
  it('builds command and link buttons', () => {
    const rawKeyboard = buildResponseKeyboard([
      button(),
      button({
        id: 2,
        label: 'Открыть сайт',
        action: 'open_link',
        target: 'https://example.com/catalog',
        row_number: 2,
      }),
    ]);
    const keyboard = JSON.parse(rawKeyboard ?? '{}') as {
      inline: boolean;
      buttons: Array<Array<{ action: { type: string; link?: string } }>>;
    };

    expect(keyboard.inline).toBe(true);
    expect(keyboard.buttons).toHaveLength(2);
    expect(keyboard.buttons[0]?.[0]?.action.type).toBe('text');
    expect(keyboard.buttons[1]?.[0]?.action).toMatchObject({
      type: 'open_link',
      link: 'https://example.com/catalog',
    });
  });

  it('ignores disabled and unsafe link buttons', () => {
    expect(
      buildResponseKeyboard([
        button({ enabled: false }),
        button({ action: 'open_link', target: 'javascript:alert(1)' }),
      ]),
    ).toBeUndefined();
  });
});

describe('keywordFromButtonPayload', () => {
  it('extracts a keyword from a command button payload', () => {
    expect(keywordFromButtonPayload({ keyword: '  кот дня  ' })).toBe('кот дня');
    expect(keywordFromButtonPayload({ other: 'value' })).toBeNull();
  });
});
