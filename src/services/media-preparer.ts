import { VK } from 'vk-io';
import type { Logger } from '../config/logger.js';
import type { MediaAsset } from '../domain/types.js';
import type { ContentClient } from './botcrm-content-client.js';
import type { YandexDiskClient } from './yandex-disk-client.js';
import type { VkVideoTokenProvider } from './vk-video-token-provider.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

export class MediaPreparer {
  constructor(
    private readonly contentClient: ContentClient,
    private readonly yandexDisk: YandexDiskClient,
    private readonly vk: VK,
    private readonly videoTokenProvider: VkVideoTokenProvider,
    private readonly groupId: number,
    private readonly uploadPeerId: number,
    private readonly logger: Logger,
  ) {}

  async prepare(asset: MediaAsset): Promise<void> {
    await this.contentClient.updateMedia(asset.id, { status: 'processing', error_message: null });

    try {
      const file = await this.yandexDisk.getDownloadableFile(asset.yandex_path);
      const source = {
        value: file.href,
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
      await this.contentClient.updateMedia(asset.id, {
        status: 'ready',
        vk_attachment: vkAttachment,
        mime_type: file.mimeType,
        file_size: file.size,
        error_message: null,
      });
      this.logger.info({ mediaId: asset.id, vkAttachment }, 'Media prepared');
    } catch (error) {
      const message = errorMessage(error);
      await this.contentClient.updateMedia(asset.id, {
        status: 'error',
        error_message: message,
      });
      this.logger.error({ err: error, mediaId: asset.id }, 'Media preparation failed');
    }
  }
}
