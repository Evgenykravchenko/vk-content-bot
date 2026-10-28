import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotCrmContentClient } from '../src/services/botcrm-content-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BotCrmContentClient isolation', () => {
  it('uses only the BotCRM runtime API and its per-bot token', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new BotCrmContentClient(
      'https://crm.example.test/api/v1',
      `bcr_${'x'.repeat(43)}`,
    );
    await client.getRules();
    await client.getQueuedMedia(3);

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls).toHaveLength(2);
    expect(urls[0]?.pathname).toBe('/api/v1/bot-content/rules');
    expect(urls[1]?.pathname).toBe('/api/v1/bot-content/media/queued');
    const requestHeaders = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(requestHeaders.get('authorization')).toBe(`Bearer bcr_${'x'.repeat(43)}`);
  });
});
