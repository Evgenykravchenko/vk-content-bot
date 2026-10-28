import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from '../config/logger.js';

const persistedStateSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().default(''),
  device_id: z.string().default(''),
  expires_at: z.number().int().nonnegative().default(0),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  device_id: z.string().optional(),
  state: z.string(),
});

type PersistedState = z.infer<typeof persistedStateSchema>;

export interface VkVideoTokenConfig {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  clientId: number;
  redirectUri: string;
  expiresAt: number;
  tokenFile: string;
}

export class VkVideoTokenProvider {
  private state: PersistedState | null = null;
  private loaded = false;
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly config: VkVideoTokenConfig,
    private readonly logger: Logger,
  ) {}

  async getToken(): Promise<string> {
    await this.load();

    if (!this.state?.access_token) {
      throw new Error('VK video authorization is not configured');
    }

    if (!this.shouldRefresh(this.state)) return this.state.access_token;
    if (!this.state.refresh_token || !this.state.device_id || this.config.clientId <= 0) {
      throw new Error('VK video token expired and refresh credentials are incomplete');
    }

    this.refreshInFlight ??= this.refresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const contents = await readFile(this.config.tokenFile, 'utf8');
      this.state = persistedStateSchema.parse(JSON.parse(contents));
      return;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : null;
      if (code !== 'ENOENT') {
        this.logger.warn({ err: error }, 'Could not read persisted VK video token state');
      }
    }

    if (!this.config.accessToken) return;
    this.state = {
      access_token: this.config.accessToken,
      refresh_token: this.config.refreshToken,
      device_id: this.config.deviceId,
      expires_at: this.config.expiresAt,
    };
    await this.persist(this.state);
  }

  private shouldRefresh(state: PersistedState): boolean {
    if (!state.refresh_token) return false;
    if (state.expires_at <= 0) return true;
    return state.expires_at <= Date.now() + 5 * 60 * 1000;
  }

  private async refresh(): Promise<string> {
    const current = this.state;
    if (!current) throw new Error('VK video token state is unavailable');

    const requestState = randomBytes(32).toString('hex');
    const endpoint = new URL('https://id.vk.ru/oauth2/auth');
    endpoint.searchParams.set('grant_type', 'refresh_token');
    endpoint.searchParams.set('redirect_uri', this.config.redirectUri);
    endpoint.searchParams.set('client_id', String(this.config.clientId));
    endpoint.searchParams.set('device_id', current.device_id);
    endpoint.searchParams.set('state', requestState);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: current.refresh_token }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`VK video token refresh failed with status ${response.status}`);
    }

    const token = tokenResponseSchema.parse(payload);
    if (token.state !== requestState) {
      throw new Error('VK video token refresh returned an invalid state');
    }

    const nextState: PersistedState = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      device_id: token.device_id ?? current.device_id,
      expires_at: Date.now() + token.expires_in * 1000,
    };
    await this.persist(nextState);
    this.state = nextState;
    this.logger.info('VK video access token refreshed');
    return nextState.access_token;
  }

  private async persist(state: PersistedState): Promise<void> {
    const directory = path.dirname(this.config.tokenFile);
    const temporaryFile = `${this.config.tokenFile}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await chmod(temporaryFile, 0o600);
    await rename(temporaryFile, this.config.tokenFile);
  }
}
