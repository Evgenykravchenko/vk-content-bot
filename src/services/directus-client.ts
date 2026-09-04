import type {
  BotSettings,
  ContentResponse,
  KeywordRule,
  MediaAsset,
  PreparedResponse,
  ResponseBlock,
  ResponseButton,
} from '../domain/types.js';

interface DirectusEnvelope<T> {
  data: T;
}

export class DirectusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = 'DirectusError';
  }
}

export class DirectusClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
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
      throw new DirectusError(
        `Directus request failed: ${response.status} ${response.statusText}`,
        response.status,
        responseBody,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async getRules(): Promise<KeywordRule[]> {
    const query = new URLSearchParams({
      'filter[enabled][_eq]': 'true',
      fields: 'id,phrase,match_mode,priority,response,enabled',
      sort: '-priority,-phrase',
      limit: '-1',
    });
    const result = await this.request<DirectusEnvelope<KeywordRule[]>>(
      `/items/keywords?${query.toString()}`,
    );
    return result.data;
  }

  async getBotSettings(): Promise<BotSettings | null> {
    try {
      const query = new URLSearchParams({ fields: 'unknown_message,fallback_response' });
      const result = await this.request<DirectusEnvelope<BotSettings>>(
        `/items/bot_settings?${query.toString()}`,
      );
      return result.data;
    } catch (error) {
      if (error instanceof DirectusError && error.status === 404) return null;
      throw error;
    }
  }

  async getPreparedResponse(responseId: number): Promise<PreparedResponse | null> {
    const responseQuery = new URLSearchParams({
      'filter[id][_eq]': String(responseId),
      'filter[status][_eq]': 'published',
      fields: 'id,name,status,fallback_text',
      limit: '1',
    });
    const responseResult = await this.request<DirectusEnvelope<ContentResponse[]>>(
      `/items/responses?${responseQuery.toString()}`,
    );
    const response = responseResult.data[0];
    if (!response) return null;

    const blocksQuery = new URLSearchParams({
      'filter[response][_eq]': String(responseId),
      'filter[enabled][_eq]': 'true',
      fields: 'id,response,sort,kind,body,send_separately,enabled,media.*',
      sort: 'sort,id',
      limit: '-1',
    });
    const blocksResult = await this.request<DirectusEnvelope<ResponseBlock[]>>(
      `/items/response_blocks?${blocksQuery.toString()}`,
    );

    const buttonsQuery = new URLSearchParams({
      'filter[response][_eq]': String(responseId),
      'filter[enabled][_eq]': 'true',
      fields: 'id,response,label,action,target,color,row_number,sort,enabled',
      sort: 'row_number,sort,id',
      limit: '-1',
    });
    const buttonsResult = await this.request<DirectusEnvelope<ResponseButton[]>>(
      `/items/response_buttons?${buttonsQuery.toString()}`,
    );

    return { response, blocks: blocksResult.data, buttons: buttonsResult.data };
  }

  async getQueuedMedia(limit: number): Promise<MediaAsset[]> {
    const query = new URLSearchParams({
      'filter[status][_eq]': 'queued',
      fields: '*',
      sort: 'id',
      limit: String(limit),
    });
    const result = await this.request<DirectusEnvelope<MediaAsset[]>>(
      `/items/media_assets?${query.toString()}`,
    );
    return result.data;
  }

  async updateMedia(id: number, changes: Partial<MediaAsset>): Promise<MediaAsset> {
    const result = await this.request<DirectusEnvelope<MediaAsset>>(`/items/media_assets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
    return result.data;
  }
}
