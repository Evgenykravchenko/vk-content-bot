import { VK } from 'vk-io';
import type { Logger } from '../config/logger.js';
import type { MediaAsset } from '../domain/types.js';
import type { ContentClient } from './botcrm-content-client.js';
import type { YandexDiskClient } from './yandex-disk-client.js';
import type { VkVideoTokenProvider } from './vk-video-token-provider.js';
import { ProgressReporter, trackedDownload, TransferProgress } from './transfer-progress.js';

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s"'<>]+/giu, '[URL скрыт]').slice(0, 1000);
}

export class MediaPreparer {
  constructor(
    private readonly contentClient: ContentClient,
    private readonly yandexDisk: YandexDiskClient,
    private readonly vk: VK,
    private readonly videoTokenProvider: VkVideoTokenProvider,
    private readonly groupId: number,
    private readonly uploadPeerId: number,
    private readonly uploadTimeout: number,
    private readonly logger: Logger,
  ) {}

  async prepare(asset: MediaAsset): Promise<void> {
    const tracker = new TransferProgress(asset.file_size ?? null);
    const reporter = new ProgressReporter(
      tracker,
      (preparation) =>
        this.contentClient.updateMedia(asset.id, { preparation, yandex_path: asset.yandex_path }),
      () => this.logger.warn({ mediaId: asset.id }, 'Transfer progress update unavailable'),
    );
    await this.contentClient.updateMedia(asset.id, {
      status: 'processing',
      yandex_path: asset.yandex_path,
      error_message: null,
      preparation: tracker.snapshot(),
    });
    reporter.start();
    let stream: ReturnType<typeof trackedDownload> | undefined;

    try {
      const file = await this.yandexDisk.getDownloadableFile(asset.yandex_path);
      tracker.setTotal(file.size);
      reporter.flush();
      stream = trackedDownload(file, tracker, reporter, this.uploadTimeout);
      const source = {
        value: stream,
        filename: file.name,
        contentType: file.mimeType,
        contentLength: file.size,
      };

      let attachment: { toString(): string };
      switch (asset.kind) {
        case 'photo':
          attachment = await this.vk.upload.messagePhoto({
            peer_id: this.uploadPeerId,
            source,
          });
          break;
        case 'video':
          attachment = await new VK({
            token: await this.videoTokenProvider.getToken(),
            uploadTimeout: this.uploadTimeout,
          }).upload.video({
            source,
            group_id: this.groupId,
            name: asset.name,
            description: 'Материал подготовлен для выдачи через сообщения сообщества.',
            wallpost: 0,
            is_private: 1,
            no_comments: 1,
          });
          break;
        case 'audio':
        case 'document':
          attachment = await this.vk.upload.messageDocument({
            peer_id: this.uploadPeerId,
            source,
            title: asset.name,
          });
          break;
      }

      const vkAttachment = attachment.toString();
      await reporter.stop();
      await this.contentClient.updateMedia(asset.id, {
        status: 'ready',
        yandex_path: asset.yandex_path,
        vk_attachment: vkAttachment,
        mime_type: file.mimeType,
        file_size: file.size,
        error_message: null,
      });
      this.logger.info({ mediaId: asset.id, vkAttachment }, 'Media prepared');
    } catch (error) {
      stream?.destroy();
      await reporter.stop();
      const message = errorMessage(error);
      await this.contentClient.updateMedia(asset.id, {
        status: 'error',
        yandex_path: asset.yandex_path,
        error_message: message,
      });
      const code =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
      this.logger.error(
        {
          err: { type: error instanceof Error ? error.name : 'Error', message, code },
          mediaId: asset.id,
        },
        'Media preparation failed',
      );
    } finally {
      stream?.destroy();
      await reporter.stop();
    }
  }
}
