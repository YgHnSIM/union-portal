import fs from 'node:fs/promises';
import path from 'node:path';

export interface BlobStorage {
  put(key: string, data: Uint8Array | Buffer): Promise<string>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export function normalizeBlobKey(rawKey: string): string {
  const normalized = String(rawKey ?? '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('Blob key must not be empty');
  }
  if (normalized.includes('\0') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Unsafe blob key: ${rawKey}`);
  }
  const segments = normalized.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error(`Path traversal is not allowed in blob key: ${rawKey}`);
  }
  return segments.join('/');
}

export class LocalFileStorage implements BlobStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  resolvePath(rawKey: string): { key: string; absPath: string } {
    const key = normalizeBlobKey(rawKey);
    const absPath = path.resolve(this.rootDir, ...key.split('/'));
    const rel = path.relative(this.rootDir, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Resolved path escapes rootDir: ${rawKey}`);
    }
    return { key, absPath };
  }

  async put(rawKey: string, data: Uint8Array | Buffer): Promise<string> {
    const { key, absPath } = this.resolvePath(rawKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, data);
    return key;
  }

  async get(rawKey: string): Promise<Buffer> {
    const { absPath } = this.resolvePath(rawKey);
    return fs.readFile(absPath);
  }

  async exists(rawKey: string): Promise<boolean> {
    const { absPath } = this.resolvePath(rawKey);
    try {
      const stat = await fs.stat(absPath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async delete(rawKey: string): Promise<void> {
    const { absPath } = this.resolvePath(rawKey);
    try {
      await fs.unlink(absPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async list(prefix = ''): Promise<string[]> {
    const cleanPrefix = prefix ? normalizeBlobKey(prefix.replace(/\/+$/, '')) : '';
    const startDir = cleanPrefix ? this.resolvePath(cleanPrefix).absPath : this.rootDir;
    const keys: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          keys.push(path.relative(this.rootDir, full).replace(/\\/g, '/'));
        }
      }
    };

    await walk(startDir);
    return keys.sort();
  }
}
