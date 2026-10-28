import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VK_TOKEN: z.string().min(1, 'VK_TOKEN is required'),
  VK_VIDEO_TOKEN: z.string().optional().default(''),
  VK_VIDEO_REFRESH_TOKEN: z.string().optional().default(''),
  VK_VIDEO_DEVICE_ID: z.string().optional().default(''),
  VK_VIDEO_CLIENT_ID: z.coerce.number().int().nonnegative().default(0),
  VK_VIDEO_REDIRECT_URI: z
    .string()
    .url()
    .default('https://bot-content-cms.tailcc0b45.ts.net/vk-oauth/callback'),
  VK_VIDEO_TOKEN_EXPIRES_AT: z.coerce.number().int().nonnegative().default(0),
  VK_VIDEO_TOKEN_FILE: z.string().min(1).default('/var/lib/vk-content-bot/vk-video-token.json'),
  VK_GROUP_ID: z.coerce.number().int().positive(),
  VK_MEDIA_UPLOAD_PEER_ID: z.coerce.number().int().positive(),
  BOTCRM_URL: z.string().url().default('http://localhost:4100/api/v1'),
  BOTCRM_CONTENT_TOKEN: z.string().min(40, 'BOTCRM_CONTENT_TOKEN is required'),
  YANDEX_DISK_TOKEN: z.string().optional().default(''),
  YANDEX_DISK_ROOT: z.string().default('/VK Bot'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RULE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  MEDIA_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(20),
  MEDIA_BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(3),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
