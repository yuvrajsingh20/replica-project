import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../');
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.local'), override: true });

function assertDevUrl(url: string, label: string): void {
  if (!url.includes('localhost') && !url.includes('_dev')) {
    throw new Error(
      `REFUSING ${label}: URL must contain "localhost" or "_dev". Got: ${redact(url)}`,
    );
  }
}

function redact(url: string): string {
  return url.replace(/:([^:@/]+)@/, ':***@');
}

/** Migrations / drizzle-kit only — direct Postgres (port 5432). */
export function getDirectUrl(): string {
  const url = process.env['DIRECT_URL']?.trim();
  if (!url) throw new Error('DIRECT_URL is not set');
  assertDevUrl(url, 'DIRECT_URL');
  return url;
}

/** Runtime only — transaction pooler (port 6543). Must NOT be :5432. */
export function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL']?.trim();
  if (!url) throw new Error('DATABASE_URL is not set');
  assertDevUrl(url, 'DATABASE_URL');
  assertNotDirectPort(url);
  return url;
}

/** Fail loudly if a runtime client was given the direct :5432 URL. */
export function assertNotDirectPort(url: string): void {
  if (/:(?:5432)(?:\/|$|\?)/.test(url) || /@[^/?#]+:5432(?:\/|$|\?)/.test(url)) {
    throw new Error(
      'REFUSING runtime DATABASE_URL: port 5432 is the direct connection. ' +
        'Use the transaction pooler (6543) with prepare: false. ' +
        'Migrations must use DIRECT_URL instead.',
    );
  }
}
