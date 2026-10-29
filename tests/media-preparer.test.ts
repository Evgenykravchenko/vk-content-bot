import { describe, expect, it, vi } from 'vitest';
import type { VK } from 'vk-io';
import type { Logger } from '../src/config/logger.js';
import type { MediaAsset } from '../src/domain/types.js';
import type { ContentClient } from '../src/services/botcrm-content-client.js';
import { MediaPreparer } from '../src/services/media-preparer.js';
import type { VkVideoTokenProvider } from '../src/services/vk-video-token-provider.js';
import type { YandexDiskClient } from '../src/services/yandex-disk-client.js';

describe('MediaPreparer errors', () => {
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
