import fs from 'node:fs/promises';
import path from 'node:path';
import type { Client } from '@libsql/client';

export async function migrateSqlite(client: Client, migrationsDir: string): Promise<string[]> {
  await client.execute('PRAGMA foreign_keys = ON;');
  await client.execute(`
    CREATE TABLE IF NOT EXISTS __union_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const existing = await client.execute('SELECT id FROM __union_migrations');
  const appliedSet = new Set(existing.rows.map((row) => String(row.id)));

  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  const newlyApplied: string[] = [];
  for (const fileName of sqlFiles) {
    if (appliedSet.has(fileName)) continue;
    const sqlText = await fs.readFile(path.join(migrationsDir, fileName), 'utf8');
    await client.executeMultiple(sqlText);
    await client.execute({
      sql: 'INSERT INTO __union_migrations (id, applied_at) VALUES (?, ?)',
      args: [fileName, new Date().toISOString()],
    });
    newlyApplied.push(fileName);
  }
  await client.execute('PRAGMA foreign_keys = ON;');
  return newlyApplied;
}
