import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.local'), override: true });

const url = process.env['DIRECT_URL']?.trim();
if (!url) {
  throw new Error('DIRECT_URL is not set (drizzle migrations must use the direct Postgres URL)');
}
if (!url.includes('localhost') && !url.includes('_dev')) {
  throw new Error('REFUSING drizzle-kit: DIRECT_URL must contain "localhost" or "_dev"');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
