import { hashSync } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function newId(prefix?: string): string {
  return prefix ? `${prefix}_${nanoid()}` : nanoid();
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : `rule-${nanoid(8)}`;
}

export function hashApiKey(raw: string): string {
  return hashSync(raw, 10);
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `re_${randomBytes(24).toString('base64url')}`;
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 8) };
}
