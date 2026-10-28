const baseUrl = process.env.BOTCRM_URL;
if (!baseUrl) process.exit(1);

try {
  const response = await fetch(new URL('health', `${baseUrl.replace(/\/+$/, '')}/`), {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
