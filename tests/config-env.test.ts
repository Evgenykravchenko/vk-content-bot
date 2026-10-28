import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const requiredEnvironment = {
  VK_TOKEN: 'community-token',
  VK_GROUP_ID: '2254462172',
  VK_MEDIA_UPLOAD_PEER_ID: '186600798',
  DIRECTUS_TOKEN: 'directus-token',
};

describe('loadConfig', () => {
  it('coerces numeric values and applies safe defaults', () => {
    const config = loadConfig(requiredEnvironment);

    expect(config.VK_GROUP_ID).toBe(2254462172);
    expect(config.VK_MEDIA_UPLOAD_PEER_ID).toBe(186600798);
    expect(config.CONTENT_BOT_KEY).toBe('vk-content-bot');
    expect(config.DIRECTUS_URL).toBe('http://localhost:8055');
    expect(config.MEDIA_BATCH_SIZE).toBe(3);
  });

  it('reports invalid environment fields without exposing secret values', () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        DIRECTUS_URL: 'not-a-url',
        MEDIA_BATCH_SIZE: '21',
      }),
    ).toThrow(/DIRECTUS_URL:|MEDIA_BATCH_SIZE:/);
  });
});
