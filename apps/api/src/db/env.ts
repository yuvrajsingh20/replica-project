import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../../');
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.local'), override: true });

export function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL']?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  return url;
}

/** Hard refuse — fail loud. Do not warn and continue. */
export function assertSafeDatabaseUrl(url: string): void {
  if (!url.includes('localhost') && !url.includes('_dev')) {
    throw new Error(
      `REFUSING database operation: DATABASE_URL must contain "localhost" or "_dev". Got: ${redactUrl(url)}`,
    );
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url.replace(/:([^:@/]+)@/, ':***@');
  }
}

