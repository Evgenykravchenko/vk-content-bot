import { describe, expect, it, vi } from 'vitest';
import type { VK } from 'vk-io';
import type { Logger } from '../src/config/logger.js';
import type { MediaAsset } from '../src/domain/types.js';
import type { ContentClient } from '../src/services/botcrm-content-client.js';
import { MediaPreparer } from '../src/services/media-preparer.js';
import type { Readable } from 'node:stream';
import type { VkVideoTokenProvider } from '../src/services/vk-video-token-provider.js';
import type { YandexDiskClient } from '../src/services/yandex-disk-client.js';

describe('MediaPreparer errors', () => {
  it.each(['photo', 'document'] as const)(
    'streams %s and finishes telemetry before publishing readiness',
    async (kind) => {
      const updateMedia = vi
        .fn<ContentClient['updateMedia']>()
        .mockResolvedValue({ id: 1 } as MediaAsset);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4])));
      const upload = vi.fn(
        async ({ source }: { source: { value: Readable; contentLength: number } }) => {
          expect(source.contentLength).toBe(4);
          const chunks = await source.value.toArray();
          expect(Buffer.concat(chunks as Buffer[])).toEqual(Buffer.from([1, 2, 3, 4]));
          return { toString: () => `${kind}1_2` };
        },
      );
      try {
        const preparer = new MediaPreparer(
          { updateMedia } as unknown as ContentClient,
          {
            getDownloadableFile: vi.fn().mockResolvedValue({
              href: 'https://download.example/test',
              name: 'file',
              size: 4,
              mimeType: 'application/octet-stream',
            }),
          } as unknown as YandexDiskClient,
          { upload: { messagePhoto: upload, messageDocument: upload } } as unknown as VK,
          {} as VkVideoTokenProvider,
          1,
          1,
          5000,
          { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
        );
        await preparer.prepare({
          id: 1,
          kind,
          yandex_path: '/library/file',
          file_size: null,
        } as MediaAsset);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(
          updateMedia.mock.calls.some(([, changes]) => changes.preparation?.stage === 'finalizing'),
        ).toBe(true);
        expect(updateMedia.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'ready', file_size: 4 });
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  it('keeps signed download URLs out of CMS errors and logs', async () => {
    const updateMedia = vi
      .fn<ContentClient['updateMedia']>()
      .mockResolvedValue({ id: 1 } as MediaAsset);
    const errorLog =
      vi.fn<
        (
          record: { err: { code?: string; message: string; type: string }; mediaId: number },
          message: string,
        ) => void
      >();
    const signedUrl = 'https://downloader.example/file?signature=private-test-value';
    const failure = Object.assign(new Error(`request to ${signedUrl} failed`), {
      code: 'ETIMEDOUT',
    });
    const preparer = new MediaPreparer(
      { updateMedia } as unknown as ContentClient,
      { getDownloadableFile: vi.fn().mockRejectedValue(failure) } as unknown as YandexDiskClient,
      {} as VK,
      {} as VkVideoTokenProvider,
      1,
      1,
      60_000,
      { error: errorLog } as unknown as Logger,
    );
    await preparer.prepare({ id: 1, yandex_path: '/library/file.mov' } as MediaAsset);
    const changes = updateMedia.mock.calls.at(-1)?.[1];
    expect(changes?.status).toBe('error');
    expect(changes?.error_message).toContain('[URL скрыт]');
    expect(JSON.stringify(updateMedia.mock.calls)).not.toContain(signedUrl);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private-test-value');
    expect(errorLog.mock.calls[0]?.[0].err.code).toBe('ETIMEDOUT');
  });
});
