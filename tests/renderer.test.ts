import { describe, expect, it } from 'vitest';
import { renderResponse } from '../src/domain/renderer.js';
import type { PreparedResponse } from '../src/domain/types.js';

const response: PreparedResponse = {
  response: { id: 1, name: 'Demo', status: 'published', fallback_text: null },
  buttons: [],
  blocks: [
    {
      id: 1,
      response: 1,
      sort: 10,
      kind: 'text',
      body: 'Описание',
      media: null,
      send_separately: false,
      enabled: true,
    },
    {
      id: 2,
      response: 1,
      sort: 20,
      kind: 'video',
      body: null,
      media: {
        id: 1,
        name: 'Видео',
        kind: 'video',
        yandex_path: '/VK Bot/video.mp4',
        status: 'ready',
        vk_attachment: 'video-1_2_key',
        mime_type: 'video/mp4',
        file_size: 100,
        error_message: null,
      },
      send_separately: false,
      enabled: true,
    },
  ],
};

describe('renderResponse', () => {
  it('combines text and a ready attachment', () => {
    expect(renderResponse(response)).toEqual([
      { message: 'Описание', attachment: ['video-1_2_key'] },
    ]);
  });

  it('attaches an inline keyboard to the last message', () => {
    const withButton: PreparedResponse = {
      ...response,
      buttons: [
        {
          id: 1,
          response: 1,
          label: 'Ещё котика 😺',
          action: 'text',
          target: 'кот дня',
          color: 'positive',
          row_number: 1,
          sort: 10,
          enabled: true,
        },
      ],
    };

    const rendered = renderResponse(withButton);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.keyboard).toBeTypeOf('string');

    const keyboard = JSON.parse(rendered[0]?.keyboard ?? '{}') as {
      inline: boolean;
      buttons: Array<Array<{ color: string; action: { label: string; payload: string } }>>;
    };
    expect(keyboard.inline).toBe(true);
    expect(keyboard.buttons[0]?.[0]?.color).toBe('positive');
    expect(keyboard.buttons[0]?.[0]?.action.label).toBe('Ещё котика 😺');
    expect(JSON.parse(keyboard.buttons[0]?.[0]?.action.payload ?? '{}')).toEqual({
      keyword: 'кот дня',
    });
  });
});
