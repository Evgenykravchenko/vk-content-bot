import pino from 'pino';

export function createLogger(level: string, pretty = process.env.NODE_ENV !== 'production') {
  return pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
    redact: {
      paths: ['token', '*.token', 'authorization', '*.authorization'],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
