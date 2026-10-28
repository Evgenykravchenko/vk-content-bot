import { VK, getRandomId } from 'vk-io';
import type { MessageContext } from 'vk-io';
import type { AppConfig } from './config/env.js';
import type { Logger } from './config/logger.js';
import type { PreparedResponse } from './domain/types.js';
import { renderResponse } from './domain/renderer.js';
import { keywordFromButtonPayload } from './domain/keyboard.js';
import { ContentService } from './services/content-service.js';
import { BotCrmContentClient } from './services/botcrm-content-client.js';
import { MediaPreparer } from './services/media-preparer.js';
import { MediaWorker } from './services/media-worker.js';
import { YandexDiskClient } from './services/yandex-disk-client.js';
import { VkVideoTokenProvider } from './services/vk-video-token-provider.js';

export class Application {
  private readonly vk: VK;
  private readonly content: ContentService;
  private readonly mediaWorker: MediaWorker | null;
  private stopping = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    const uploadTimeout = config.MEDIA_UPLOAD_TIMEOUT_SECONDS * 1000;
    this.vk = new VK({ token: config.VK_TOKEN, uploadTimeout });
    const videoTokenProvider = new VkVideoTokenProvider(
      {
        accessToken: config.VK_VIDEO_TOKEN,
        refreshToken: config.VK_VIDEO_REFRESH_TOKEN,
        deviceId: config.VK_VIDEO_DEVICE_ID,
        clientId: config.VK_VIDEO_CLIENT_ID,
        redirectUri: config.VK_VIDEO_REDIRECT_URI,
        expiresAt: config.VK_VIDEO_TOKEN_EXPIRES_AT * 1000,
        tokenFile: config.VK_VIDEO_TOKEN_FILE,
      },
      logger,
    );
    const contentClient = new BotCrmContentClient(config.BOTCRM_URL, config.BOTCRM_CONTENT_TOKEN);
    this.content = new ContentService(contentClient, config.RULE_CACHE_TTL_SECONDS * 1000, logger);

    if (config.YANDEX_DISK_TOKEN) {
      const yandexDisk = new YandexDiskClient(config.YANDEX_DISK_TOKEN);
      const preparer = new MediaPreparer(
        contentClient,
        yandexDisk,
        this.vk,
        videoTokenProvider,
        config.VK_GROUP_ID,
        config.VK_MEDIA_UPLOAD_PEER_ID,
        uploadTimeout,
        logger,
      );
      this.mediaWorker = new MediaWorker(
        contentClient,
        preparer,
        config.MEDIA_POLL_INTERVAL_SECONDS * 1000,
        config.MEDIA_BATCH_SIZE,
        logger,
      );
    } else {
      this.mediaWorker = null;
      logger.warn('YANDEX_DISK_TOKEN is empty: media preparation is disabled');
    }
  }

  async start(): Promise<void> {
    this.registerHandlers();
    this.mediaWorker?.start();
    await this.vk.updates.startPolling();
    this.logger.info(
      { groupId: this.config.VK_GROUP_ID, contentSource: 'botcrm' },
      'VK bot started',
    );
  }

  async stop(signal: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.logger.info({ signal }, 'Stopping application');
    this.mediaWorker?.stop();
    await this.vk.updates.stop();
  }

  private registerHandlers(): void {
    this.vk.updates.on('message_new', async (context) => {
      if (!context.isInbox || context.senderId < 0) return;

      try {
        const text = keywordFromButtonPayload(context.messagePayload) ?? context.text?.trim() ?? '';
        if (!text) return;

        const content = await this.content.findResponse(text);
        if (!content) {
          const fallback = await this.content.getFallbackContent();
          let sent = false;
          if (fallback.response) {
            sent = await this.sendResponse(context, fallback.response);
          }
          if (!sent && fallback.message) {
            await context.send({
              message: fallback.message,
              random_id: getRandomId(),
            });
          }
          return;
        }

        await this.sendResponse(context, content);

        this.logger.info(
          { senderId: context.senderId, responseId: content.response.id },
          'Response sent',
        );
      } catch (error) {
        this.logger.error({ err: error, senderId: context.senderId }, 'Message handling failed');
        await context
          .send({
            message: 'Не удалось получить материал. Попробуйте ещё раз немного позже.',
            random_id: getRandomId(),
          })
          .catch((sendError: unknown) => {
            this.logger.error({ err: sendError }, 'Could not send error message');
          });
      }
    });
  }

  private async sendResponse(context: MessageContext, content: PreparedResponse): Promise<boolean> {
    const messages = renderResponse(content);
    for (const outgoing of messages) {
      const options = {
        random_id: getRandomId(),
        ...(outgoing.message ? { message: outgoing.message } : {}),
        ...(outgoing.attachment ? { attachment: outgoing.attachment } : {}),
        ...(outgoing.keyboard ? { keyboard: outgoing.keyboard } : {}),
      };
      await context.send(options);
    }
    return messages.length > 0;
  }
}
