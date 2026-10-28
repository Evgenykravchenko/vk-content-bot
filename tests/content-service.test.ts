import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/config/logger.js';
import type { PreparedResponse } from '../src/domain/types.js';
import { ContentService } from '../src/services/content-service.js';
import type { ContentClient } from '../src/services/botcrm-content-client.js';

const preparedResponse: PreparedResponse = {
  response: {
    id: 7,
    name: 'Fallback',
    status: 'published',
    fallback_text: null,
  },
  blocks: [],
  buttons: [],
};

function createContentStub(overrides: Partial<ContentClient>): ContentClient {
  return {
    getRules: vi.fn().mockResolvedValue([]),
    getBotSettings: vi.fn().mockResolvedValue(null),
    getPreparedResponse: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ContentClient;
}

describe('ContentService fallback', () => {
  it('returns the configured published fallback response', async () => {
    const contentClient = createContentStub({
      getBotSettings: vi.fn().mockResolvedValue({
        unknown_message: 'Запасной текст',
        fallback_response: 7,
      }),
      getPreparedResponse: vi.fn().mockResolvedValue(preparedResponse),
    });
    const service = new ContentService(contentClient, 30_000, createLogger('silent', false));

    await expect(service.getFallbackContent()).resolves.toEqual({
      response: preparedResponse,
      message: 'Запасной текст',
    });
  });

  it('uses the fallback message when the response is unavailable', async () => {
    const contentClient = createContentStub({
      getBotSettings: vi.fn().mockResolvedValue({
        unknown_message: '  Попробуйте другое слово  ',
        fallback_response: 7,
      }),
      getPreparedResponse: vi.fn().mockResolvedValue(null),
    });
    const service = new ContentService(contentClient, 30_000, createLogger('silent', false));

    await expect(service.getFallbackContent()).resolves.toEqual({
      response: null,
      message: 'Попробуйте другое слово',
    });
  });

  it('returns an empty fallback when silent mode is configured', async () => {
    const contentClient = createContentStub({
      getBotSettings: vi.fn().mockResolvedValue({
        unknown_message: null,
        fallback_response: null,
      }),
    });
    const service = new ContentService(contentClient, 30_000, createLogger('silent', false));

    await expect(service.getFallbackContent()).resolves.toEqual({
      response: null,
      message: null,
    });
  });
});
