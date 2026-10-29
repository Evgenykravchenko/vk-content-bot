import { VK } from 'vk-io';
import type { MessageContext } from 'vk-io';
import type { AppConfig } from './config/env.js';
import type { Logger } from './config/logger.js';
import type { PreparedResponse } from './domain/types.js';
import { renderResponse } from './domain/renderer.js';
import { keywordFromButtonPayload } from './domain/keyboard.js';
import { ContentService } from './services/content-service.js';
import { BotCrmContentClient } from './services/botcrm-content-client.js';
import {
  BotCrmDialogClient,
  BotCrmDialogError,
  type DialogAttachment,
  type DialogButton,
  type DialogProfile,
} from './services/botcrm-dialog-client.js';
import { MediaPreparer } from './services/media-preparer.js';
import { MediaWorker } from './services/media-worker.js';
import { YandexDiskClient } from './services/yandex-disk-client.js';
import { VkVideoTokenProvider } from './services/vk-video-token-provider.js';

export class Application {
  private readonly vk: VK;
  private readonly content: ContentService;
  private readonly dialogs: BotCrmDialogClient;
  private readonly mediaWorker: MediaWorker | null;
  private readonly profileCache = new Map<number, Promise<DialogProfile>>();
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
    this.dialogs = new BotCrmDialogClient(
      config.BOTCRM_URL,
      config.BOTCRM_WORKSPACE_ID,
      config.BOTCRM_BOT_SLUG,
      config.BOTCRM_DIALOG_TOKEN,
    );

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
      {
        groupId: this.config.VK_GROUP_ID,
        contentSource: 'botcrm',
        dialogBot: this.config.BOTCRM_BOT_SLUG,
      },
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

      let conversationId: string | undefined;
      const messageId = String(context.id || context.conversationMessageId || context.createdAt);
      const eventId = `vk:${this.config.VK_GROUP_ID}:${context.peerId}:${messageId}`;
      try {
        const attachments = this.dialogAttachments(context);
        const visibleText = context.text?.trim() || this.attachmentSummary(attachments);
        const keyword =
          keywordFromButtonPayload(context.messagePayload) ?? context.text?.trim() ?? '';
        const profile = await this.loadProfile(context.senderId);
        const accepted = await this.dialogs.incoming({
          eventId,
          occurredAt: new Date(context.createdAt * 1_000).toISOString(),
          chatId: String(context.peerId),
          userId: String(context.senderId),
          externalMessageId: messageId,
          text: visibleText,
          attachments,
          profile,
          attributes: {
            source: 'vk_content_bot',
            vk_group_id: this.config.VK_GROUP_ID,
            vk_peer_id: context.peerId,
            vk_attachment_types: context.attachments.map((attachment) => attachment.type),
            matched_keyword: keyword || undefined,
          },
          raw: {
            id: context.id,
            conversation_message_id: context.conversationMessageId,
            peer_id: context.peerId,
            from_id: context.senderId,
            text: context.text,
            payload: context.messagePayload as unknown,
            attachments: context.attachments.map((attachment) => attachment.toJSON()),
          },
        });
        conversationId = accepted.conversationId;

        if (accepted.duplicate) {
          this.logger.debug({ eventId }, 'Duplicate VK message ignored');
          return;
        }
        if (!accepted.deliverToBot || !conversationId) {
          this.logger.info({ eventId, conversationId }, 'Message saved; operator controls dialog');
          return;
        }
        if (!keyword) return;

        const content = await this.content.findResponse(keyword);
        if (!content) {
          const fallback = await this.content.getFallbackContent();
          let sent = false;
          if (fallback.response) {
            sent = await this.sendResponse(conversationId, eventId, fallback.response);
          }
          if (!sent && fallback.message) {
            await this.dialogs.send({
              conversationId,
              text: fallback.message,
              idempotencyKey: `${eventId}:fallback`,
            });
          }
          return;
        }

        await this.sendResponse(conversationId, eventId, content);

        this.logger.info(
          { senderId: context.senderId, responseId: content.response.id },
          'Response sent',
        );
      } catch (error) {
        if (error instanceof BotCrmDialogError && error.code === 'bot_not_in_control') {
          this.logger.info(
            { eventId, conversationId },
            'Reply cancelled because operator took dialog',
          );
          return;
        }
        this.logger.error({ err: error, senderId: context.senderId }, 'Message handling failed');
        if (conversationId) {
          await this.dialogs
            .send({
              conversationId,
              text: 'Не удалось получить материал. Попробуйте ещё раз немного позже.',
              idempotencyKey: `${eventId}:error`,
            })
            .catch((sendError: unknown) => {
              this.logger.error({ err: sendError }, 'Could not enqueue error message');
            });
        }
      }
    });
  }

  private async sendResponse(
    conversationId: string,
    eventId: string,
    content: PreparedResponse,
  ): Promise<boolean> {
    const messages = renderResponse(content);
    for (const [index, outgoing] of messages.entries()) {
      const buttons = this.dialogButtons(outgoing.keyboard);
      await this.dialogs.send({
        conversationId,
        idempotencyKey: `${eventId}:response:${content.response.id}:${index}`,
        ...(outgoing.message ? { text: outgoing.message } : {}),
        ...(outgoing.attachment?.length ? { nativeAttachmentRefs: outgoing.attachment } : {}),
        ...(buttons ? { buttons } : {}),
      });
    }
    return messages.length > 0;
  }

  private loadProfile(userId: number): Promise<DialogProfile> {
    let pending = this.profileCache.get(userId);
    if (!pending) {
      const created: Promise<DialogProfile> = this.vk.api.users
        .get({ user_ids: [userId], fields: ['photo_200', 'city', 'screen_name'] })
        .then((users) => {
          const user = users[0];
          if (!user) return { name: `VK ${userId}` };
          const city =
            user.city && typeof user.city === 'object' && 'title' in user.city
              ? String(user.city.title || '') || undefined
              : undefined;
          return {
            name: [user.first_name, user.last_name].filter(Boolean).join(' ') || `VK ${userId}`,
            ...(city ? { city } : {}),
            ...(typeof user.photo_200 === 'string' ? { avatar_url: user.photo_200 } : {}),
          };
        })
        .catch(() => ({ name: `VK ${userId}` }));
      if (this.profileCache.size >= 1_000) {
        const oldest = this.profileCache.keys().next().value;
        if (oldest !== undefined) this.profileCache.delete(oldest);
      }
      this.profileCache.set(userId, created);
      pending = created;
    }
    return pending;
  }

  private dialogAttachments(context: MessageContext): DialogAttachment[] {
    return context.attachments.flatMap((attachment) => {
      const source = attachment as unknown as {
        type?: string;
        id?: number;
        ownerId?: number;
        url?: string;
        largeSizeUrl?: string;
        mediumSizeUrl?: string;
        smallSizeUrl?: string;
        toJSON(): Record<string, unknown>;
      };
      const type = source.type || 'file';
      const json = source.toJSON();
      const sizes = Array.isArray(json.sizes) ? (json.sizes as Array<{ url?: string }>) : [];
      const directUrl =
        source.largeSizeUrl ||
        source.mediumSizeUrl ||
        source.smallSizeUrl ||
        source.url ||
        sizes.toReversed().find((size) => typeof size.url === 'string')?.url;
      const url =
        directUrl ||
        (type === 'video' && source.ownerId && source.id
          ? `https://vk.com/video${source.ownerId}_${source.id}`
          : undefined);
      return url ? [{ type, url }] : [];
    });
  }

  private attachmentSummary(attachments: DialogAttachment[]): string {
    if (!attachments.length) return '[Сообщение без текста]';
    const labels = attachments.map(
      (attachment) =>
        ({ photo: 'фото', video: 'видео', audio_message: 'голосовое сообщение', doc: 'документ' })[
          attachment.type
        ] || attachment.type,
    );
    return `[Вложение VK: ${labels.join(', ')}]`;
  }

  private dialogButtons(keyboard?: string): DialogButton[] | undefined {
    if (!keyboard) return undefined;
    try {
      const parsed = JSON.parse(keyboard) as {
        buttons?: Array<
          Array<{
            action?: {
              type?: string;
              label?: string;
              link?: string;
              payload?: string | Record<string, unknown>;
            };
          }>
        >;
      };
      const buttons: DialogButton[] = [];
      for (const [rowIndex, row] of (parsed.buttons ?? []).entries()) {
        for (const button of row) {
          const action = button.action;
          const text = action?.label?.trim();
          if (!action || !text) continue;
          if (action.type === 'open_link' && action.link) {
            buttons.push({ text, type: 'url', value: action.link, row: rowIndex });
            continue;
          }
          let payload = action.payload;
          if (typeof payload === 'string') {
            try {
              payload = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              payload = {};
            }
          }
          const candidate =
            payload && typeof payload === 'object'
              ? (payload.keyword ?? payload.value ?? payload.command)
              : undefined;
          const value = typeof candidate === 'string' && candidate.trim() ? candidate : text;
          buttons.push({ text, type: 'callback', value, row: rowIndex });
        }
      }
      return buttons.length ? buttons : undefined;
    } catch {
      this.logger.warn('Could not convert VK keyboard for BotCRM delivery');
      return undefined;
    }
  }
}
