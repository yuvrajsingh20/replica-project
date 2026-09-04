import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { assertNotDirectPort, getDatabaseUrl, getDirectUrl } from './env.js';
import * as schema from './schema.js';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

function createSqlClient(url: string, opts: { prepare: boolean; max?: number }): Sql {
  const socketHost = /(?:\?|&)host=(\/[^&]+)/.exec(url)?.[1];
  if (socketHost) {
    const decodedHost = decodeURIComponent(socketHost);
    const dbMatch = /postgres(?:ql)?:\/\/(?:[^@/]*@)?(?:[^/]*)\/([^?]+)/.exec(url);
    const database = dbMatch?.[1] ? decodeURIComponent(dbMatch[1]) : undefined;
    if (!database) {
      throw new Error('DATABASE_URL with unix host= must include a database path');
    }
    const userMatch = /postgres(?:ql)?:\/\/([^:/?@]+)@/.exec(url);
    const options = /(?:\?|&)options=([^&]+)/.exec(url)?.[1];
    const decodedOptions = options ? decodeURIComponent(options) : undefined;
    const searchPath = decodedOptions
      ? /search_path=([^&\s]+)/i.exec(decodedOptions)?.[1]
      : undefined;

    return postgres({
      host: decodedHost,
      database,
      ...(userMatch ? { username: decodeURIComponent(userMatch[1]!) } : {}),
      max: opts.max ?? 10,
      prepare: opts.prepare,
      ...(searchPath
        ? { connection: { search_path: searchPath } as Record<string, string> }
        : {}),
    });
  }

  return postgres(url, { max: opts.max ?? 10, prepare: opts.prepare });
}

/** Runtime client — pooler URL + prepare: false. Asserts not :5432. */
export function createRuntimeDb(url = getDatabaseUrl()) {
  assertNotDirectPort(url);
  const client = createSqlClient(url, { prepare: false });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Migration client — DIRECT_URL. Prepared statements OK on direct. */
export function createDirectDb(url = getDirectUrl()) {
  const client = createSqlClient(url, { prepare: true, max: 1 });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Set JWT sub for RLS (local auth.uid() stub + Supabase-compatible). */
export async function withUser<T>(
  db: Db,
  userId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}
