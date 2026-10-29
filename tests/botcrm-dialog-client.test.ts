import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotCrmDialogClient } from '../src/services/botcrm-dialog-client.js';
import type { BotCrmDialogError } from '../src/services/botcrm-dialog-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function client() {
  return new BotCrmDialogClient(
    'https://crm.example.test/api/v1',
    'ws_demo',
    'vk_content_bot',
    'service-token-for-tests',
  );
}

describe('BotCrmDialogClient', () => {
  it('registers an incoming VK message with profile and attachments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          duplicate: false,
          conversationId: 'conversation-1',
          deliverToBot: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await client().incoming({
      eventId: 'vk:1:2:3',
      occurredAt: '2026-10-29T10:00:00.000Z',
      chatId: '2',
      userId: '3',
      externalMessageId: '4',
      text: 'тест',
      attachments: [{ type: 'photo', url: 'https://example.test/photo.jpg' }],
      profile: { name: 'Анна', city: 'Омск' },
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/api/v1/events');
    expect(new Headers(init.headers).get('x-service-token')).toBe('service-token-for-tests');
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string)).toMatchObject({
      bot_id: 'vk_content_bot',
      channel: 'vk',
      message: { text: 'тест', attachments: [{ type: 'photo' }] },
      profile: { name: 'Анна' },
    });
  });

  it('queues native VK attachments and buttons with an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await client().send({
      conversationId: 'conversation-1',
      text: 'Ваш материал',
      nativeAttachmentRefs: ['photo-1_2_abc'],
      buttons: [{ text: 'Ещё', type: 'callback', value: 'ещё', row: 0 }],
      idempotencyKey: 'reply-1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/api/v1/messages/send');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('reply-1');
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string)).toMatchObject({
      actor: 'bot',
      nativeAttachmentRefs: ['photo-1_2_abc'],
      buttons: [{ value: 'ещё' }],
    });
  });

  it('returns a structured error from BotCRM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'bot_not_in_control', message: 'Operator owns dialog' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      client().send({ conversationId: 'c1', idempotencyKey: 'reply-2' }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BotCrmDialogError>>({
        code: 'bot_not_in_control',
        status: 409,
      }),
    );
  });
});
