import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectusClient } from '../src/services/directus-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DirectusClient bot isolation', () => {
  it('scopes keyword and media queries to CONTENT_BOT_KEY', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new DirectusClient('https://cms.example.test', 'token', 'fitness-club');
    await client.getRules();
    await client.getQueuedMedia(3);

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls).toHaveLength(2);
    expect(urls[0]?.searchParams.get('filter[bot][key][_eq]')).toBe('fitness-club');
    expect(urls[1]?.searchParams.get('filter[bot][key][_eq]')).toBe('fitness-club');
  });
});
