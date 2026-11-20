import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type SqliteOrmDb = LibSQLDatabase<typeof schema>;

export interface SqliteConnection {
  client: Client;
  db: SqliteOrmDb;
  dbPath: string;
  close(): void;
}

export async function openSqliteConnection(dbPath: string): Promise<SqliteConnection> {
  const absPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const client = createClient({ url: pathToFileURL(absPath).href });
  await client.execute('PRAGMA foreign_keys = ON;');
  await client.execute('PRAGMA journal_mode = WAL;');
  await client.execute('PRAGMA busy_timeout = 5000;');
  const db = drizzle(client, { schema });
  return {
    client,
    db,
    dbPath: absPath,
    close() {
      client.close();
    },
  };
}
