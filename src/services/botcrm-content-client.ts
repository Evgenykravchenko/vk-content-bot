import type {
  BotSettings,
  KeywordRule,
  MediaAsset,
  PreparedResponse,
} from '../domain/types.js';

export class BotCrmContentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = 'BotCrmContentError';
  }
}

export interface ContentClient {
  getRules(): Promise<KeywordRule[]>;
  getBotSettings(): Promise<BotSettings | null>;
  getPreparedResponse(responseId: number): Promise<PreparedResponse | null>;
  getQueuedMedia(limit: number): Promise<MediaAsset[]>;
  updateMedia(id: number, changes: Partial<MediaAsset>): Promise<MediaAsset>;
}

export class BotCrmContentClient implements ContentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, `${this.baseUrl.replace(/\/+$/, '')}/`), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new BotCrmContentError(
        `BotCRM content request failed: ${response.status} ${response.statusText}`,
        response.status,
        responseBody,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  getRules(): Promise<KeywordRule[]> {
    return this.request<KeywordRule[]>('bot-content/rules');
  }

  getBotSettings(): Promise<BotSettings | null> {
    return this.request<BotSettings | null>('bot-content/settings');
  }

  getPreparedResponse(responseId: number): Promise<PreparedResponse | null> {
    return this.request<PreparedResponse | null>(`bot-content/responses/${responseId}`);
  }

  getQueuedMedia(limit: number): Promise<MediaAsset[]> {
    const query = new URLSearchParams({ limit: String(limit) });
    return this.request<MediaAsset[]>(`bot-content/media/queued?${query.toString()}`);
  }

  updateMedia(id: number, changes: Partial<MediaAsset>): Promise<MediaAsset> {
    return this.request<MediaAsset>(`bot-content/media/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
  }
}
