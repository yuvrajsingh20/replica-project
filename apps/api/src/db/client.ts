import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { assertSafeDatabaseUrl, getDatabaseUrl } from './env.js';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

function createSqlClient(url: string): Sql {
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
      max: 10,
      ...(searchPath
        ? { connection: { search_path: searchPath } as Record<string, string> }
        : {}),
    });
  }

  return postgres(url, { max: 10 });
}

export function createDb(url = getDatabaseUrl()) {
  assertSafeDatabaseUrl(url);
  const client = createSqlClient(url);
  const db = drizzle(client, { schema });
  return { db, client };
}
