import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VK_TOKEN: z.string().min(1, 'VK_TOKEN is required'),
  VK_GROUP_ID: z.coerce.number().int().positive(),
  VK_MEDIA_UPLOAD_PEER_ID: z.coerce.number().int().positive(),
  DIRECTUS_URL: z.string().url().default('http://localhost:8055'),
  DIRECTUS_TOKEN: z.string().min(1, 'DIRECTUS_TOKEN is required'),
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
