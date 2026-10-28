import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/config/logger.js';
import { VkVideoTokenProvider } from '../src/services/vk-video-token-provider.js';

const directories: string[] = [];
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
} as unknown as Logger;

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function tokenFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'vk-video-token-'));
  directories.push(directory);
  return path.join(directory, 'token.json');
}

describe('VkVideoTokenProvider', () => {
  it('uses and persists a static user token', async () => {
    const file = await tokenFile();
    const provider = new VkVideoTokenProvider(
      {
        accessToken: 'access-token',
        refreshToken: '',
        deviceId: '',
        clientId: 0,
        redirectUri: 'https://example.com/callback',
        expiresAt: 0,
        tokenFile: file,
      },
      logger,
    );

    await expect(provider.getToken()).resolves.toBe('access-token');
    await expect(readFile(file, 'utf8')).resolves.toContain('access-token');
  });

  it('refreshes an expired token and persists the rotated credentials', async () => {
    const file = await tokenFile();
    const fetchMock = vi.fn((input: URL) => {
      const url = new URL(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'fresh-access-token',
            refresh_token: 'fresh-refresh-token',
            expires_in: 3600,
            device_id: 'device-id',
            state: url.searchParams.get('state'),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new VkVideoTokenProvider(
      {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        deviceId: 'device-id',
        clientId: 54858060,
        redirectUri: 'https://example.com/callback',
        expiresAt: Date.now() - 1,
        tokenFile: file,
      },
      logger,
    );

    await expect(provider.getToken()).resolves.toBe('fresh-access-token');
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(readFile(file, 'utf8')).resolves.toContain('fresh-refresh-token');
  });
});
