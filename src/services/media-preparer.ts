import type { VK } from 'vk-io';
import type { Logger } from '../config/logger.js';
import type { MediaAsset } from '../domain/types.js';
import type { DirectusClient } from './directus-client.js';
import type { YandexDiskClient } from './yandex-disk-client.js';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}

export class MediaPreparer {
  constructor(
    private readonly directus: DirectusClient,
    private readonly yandexDisk: YandexDiskClient,
    private readonly vk: VK,
    private readonly groupId: number,
    private readonly uploadPeerId: number,
    private readonly logger: Logger,
  ) {}

  async prepare(asset: MediaAsset): Promise<void> {
    await this.directus.updateMedia(asset.id, { status: 'processing', error_message: null });

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
          attachment = await this.vk.upload.video({
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
      await this.directus.updateMedia(asset.id, {
        status: 'ready',
        vk_attachment: vkAttachment,
        mime_type: file.mimeType,
        file_size: file.size,
        error_message: null,
      });
      this.logger.info({ mediaId: asset.id, vkAttachment }, 'Media prepared');
    } catch (error) {
      const message = errorMessage(error);
      await this.directus.updateMedia(asset.id, {
        status: 'error',
        error_message: message,
      });
      this.logger.error({ err: error, mediaId: asset.id }, 'Media preparation failed');
    }
  }
}
