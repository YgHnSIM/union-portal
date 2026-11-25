import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const PLACEHOLDER_SALT = 'change-me-local-secret-32bytes-hex';

export function readConfiguredPrivacySalt(projectRoot: string): string | undefined {
  const fromEnv = process.env.PRIVACY_HMAC_SALT?.trim();
  if (fromEnv && fromEnv !== PLACEHOLDER_SALT) return fromEnv;

  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return undefined;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*PRIVACY_HMAC_SALT\s*=\s*(.+?)\s*$/);
    if (m?.[1]) {
      const val = m[1].replace(/^['"]|['"]$/g, '').trim();
      if (val && val !== PLACEHOLDER_SALT) {
        return val;
      }
    }
  }
  return undefined;
}

export async function ensureLocalPrivacySalt(projectRoot: string): Promise<string> {
  const configured = readConfiguredPrivacySalt(projectRoot);
  if (configured) return configured;

  const envPath = path.join(projectRoot, '.env');
  let existingContent = '';
  try {
    existingContent = await fsPromises.readFile(envPath, 'utf8');
  } catch {
    // .env not created yet
  }

  const generated = randomBytes(32).toString('hex');
  const nextLines = existingContent
    ? existingContent
        .split(/\r?\n/)
        .filter((l) => !/^\s*PRIVACY_HMAC_SALT\s*=/.test(l))
    : [];
  nextLines.push(`PRIVACY_HMAC_SALT=${generated}`);
  await fsPromises.writeFile(envPath, nextLines.join('\n').trimEnd() + '\n', 'utf8');
  return generated;
}
