import { defineConfig } from 'drizzle-kit';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dbPath = path.resolve(process.cwd(), 'data/local/union.db');

export default defineConfig({
  schema: './src/storage/sqlite/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: pathToFileURL(dbPath).href,
  },
});
