const baseUrl = process.env.DIRECTUS_URL;
if (!baseUrl) process.exit(1);

try {
  const response = await fetch(new URL('/server/health', baseUrl), {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
