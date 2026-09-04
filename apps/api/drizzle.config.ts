import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.local'), override: true });

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is not set');
}
if (!url.includes('localhost') && !url.includes('_dev')) {
  throw new Error(
    'REFUSING drizzle-kit: DATABASE_URL must contain "localhost" or "_dev"',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
