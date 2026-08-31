import type { MediaAsset, OutboundMessage, PreparedResponse } from './types.js';
import { buildResponseKeyboard } from './keyboard.js';

function mediaFromBlock(media: number | MediaAsset | null): MediaAsset | null {
  return typeof media === 'object' ? media : null;
}

function hasPayload(message: OutboundMessage): boolean {
  return Boolean(message.message?.trim() || message.attachment?.length);
}

export function renderResponse(content: PreparedResponse): OutboundMessage[] {
  const messages: OutboundMessage[] = [];
  let current: OutboundMessage = {};

  const flush = () => {
    if (hasPayload(current)) {
      messages.push(current);
    }
    current = {};
  };

  for (const block of content.blocks) {
    if (!block.enabled) continue;

    if (block.send_separately) {
      flush();
    }

    if (block.kind === 'text' && block.body?.trim()) {
      current.message = [current.message, block.body.trim()].filter(Boolean).join('\n\n');
    } else {
      const media = mediaFromBlock(block.media);
      if (media?.status === 'ready' && media.vk_attachment) {
        current.attachment = [...(current.attachment ?? []), media.vk_attachment];
      } else if (media) {
        current.message = [
          current.message,
          `Материал «${media.name}» пока подготавливается. Попробуйте немного позже.`,
        ]
          .filter(Boolean)
          .join('\n\n');
      }
    }

    if (block.send_separately) {
      flush();
    }
  }

  flush();

  const keyboard = buildResponseKeyboard(content.buttons);

  if (messages.length === 0 && content.response.fallback_text) {
    return [{ message: content.response.fallback_text, ...(keyboard ? { keyboard } : {}) }];
  }

  if (keyboard && messages.length > 0) {
    const lastMessage = messages.at(-1);
    if (lastMessage) lastMessage.keyboard = keyboard;
  }

  return messages;
}
