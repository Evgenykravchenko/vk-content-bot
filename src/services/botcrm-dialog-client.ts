export interface DialogAttachment {
  type: string;
  url: string;
}

export interface DialogProfile {
  name?: string;
  city?: string;
  avatar_url?: string;
}

export interface DialogButton {
  text: string;
  type: 'callback' | 'url';
  value: string;
  row: number;
}

export interface AcceptedDialogMessage {
  duplicate: boolean;
  conversationId?: string;
  deliverToBot?: boolean;
}

export class BotCrmDialogError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'BotCrmDialogError';
  }
}

export class BotCrmDialogClient {
  constructor(
    private readonly baseUrl: string,
    private readonly workspaceId: string,
    private readonly botSlug: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, `${this.baseUrl.replace(/\/+$/, '')}/`), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': this.workspaceId,
        'X-Service-Token': this.token,
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });

    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    if (!response.ok) {
      throw new BotCrmDialogError(
        body.error?.message || `BotCRM dialog request failed: ${response.status}`,
        response.status,
        body.error?.code || 'request_failed',
      );
    }
    return body as T;
  }

  incoming(input: {
    eventId: string;
    occurredAt: string;
    chatId: string;
    userId: string;
    externalMessageId: string;
    text: string;
    attachments?: DialogAttachment[];
    profile?: DialogProfile;
    attributes?: Record<string, unknown>;
    raw?: unknown;
  }): Promise<AcceptedDialogMessage> {
    return this.request<AcceptedDialogMessage>('events', {
      method: 'POST',
      body: JSON.stringify({
        event_id: input.eventId,
        schema_version: '1.0',
        occurred_at: input.occurredAt,
        workspace_id: this.workspaceId,
        bot_id: this.botSlug,
        channel: 'vk',
        external_chat_id: input.chatId,
        external_user_id: input.userId,
        type: 'message.received',
        message: {
          external_id: input.externalMessageId,
          text: input.text,
          attachments: input.attachments,
        },
        profile: input.profile,
        attributes: input.attributes,
        raw_payload: input.raw,
      }),
    });
  }

  send(input: {
    conversationId: string;
    text?: string;
    nativeAttachmentRefs?: string[];
    buttons?: DialogButton[];
    idempotencyKey: string;
  }): Promise<unknown> {
    return this.request('messages/send', {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({
        conversationId: input.conversationId,
        actor: 'bot',
        text: input.text ?? '',
        nativeAttachmentRefs: input.nativeAttachmentRefs,
        buttons: input.buttons,
      }),
    });
  }
}
